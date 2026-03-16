import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { dbQuery } from '../db.js';
import { logger, serializeError } from '../logger.js';
import { appConfig } from '../config.js';

/**
 * Email Deliverability Service
 * Handles DKIM signing, SPF validation, DMARC reporting
 */

// DKIM Configuration
export interface DkimConfig {
  domainName: string;
  keySelector: string;
  privateKey: string;
}

// SPF Record
export interface SpfRecord {
  domain: string;
  record: string;
  isValid: boolean;
  mechanisms: string[];
}

// DMARC Policy
export interface DmarcPolicy {
  domain: string;
  policy: 'none' | 'quarantine' | 'reject';
  subdomain_policy?: 'none' | 'quarantine' | 'reject';
  percentage?: number;
  rua?: string[]; // Aggregate report URIs
  ruf?: string[]; // Forensic report URIs
  alignment_spf?: 'relaxed' | 'strict';
  alignment_dkim?: 'relaxed' | 'strict';
}

// Deliverability Score
export interface DeliverabilityScore {
  score: number; // 0-100
  dkimConfigured: boolean;
  spfConfigured: boolean;
  dmarcConfigured: boolean;
  bounceRate: number;
  complaintRate: number;
  recommendations: string[];
}

/**
 * Get DKIM configuration from app config
 */
export const getDkimConfig = (): DkimConfig | null => {
  const domainName = String(appConfig.smtpDkimDomainName ?? '').trim();
  const keySelector = String(appConfig.smtpDkimKeySelector ?? '').trim();
  const privateKey = String(appConfig.smtpDkimPrivateKey ?? '').trim().replace(/\\n/g, '\n');

  if (!domainName || !keySelector || !privateKey) {
    return null;
  }

  return {
    domainName,
    keySelector,
    privateKey,
  };
};

/**
 * Validate DKIM configuration
 */
export const validateDkimConfig = (config: DkimConfig): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!config.domainName || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.domainName)) {
    errors.push('Invalid domain name');
  }

  if (!config.keySelector || !/^[a-z0-9._-]+$/i.test(config.keySelector)) {
    errors.push('Invalid key selector');
  }

  if (!config.privateKey || !config.privateKey.includes('BEGIN')) {
    errors.push('Invalid private key format');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Generate SPF record for domain
 */
export const generateSpfRecord = (domain: string, ipAddresses: string[] = []): string => {
  const mechanisms: string[] = ['v=spf1'];

  // Add IP addresses
  ipAddresses.forEach(ip => {
    if (ip.includes(':')) {
      mechanisms.push(`ip6:${ip}`);
    } else {
      mechanisms.push(`ip4:${ip}`);
    }
  });

  // Include common email providers
  mechanisms.push('include:_spf.google.com');
  mechanisms.push('include:spf.protection.outlook.com');

  // Default policy
  mechanisms.push('~all');

  return mechanisms.join(' ');
};

/**
 * Validate SPF record
 */
export const validateSpfRecord = (record: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!record.startsWith('v=spf1')) {
    errors.push('SPF record must start with v=spf1');
  }

  const validMechanisms = ['ip4:', 'ip6:', 'a:', 'mx:', 'include:', 'all', '+all', '-all', '~all', '?all'];
  const parts = record.split(' ');

  for (const part of parts.slice(1)) {
    const hasValidMechanism = validMechanisms.some(m => part.startsWith(m) || part === m);
    if (!hasValidMechanism && !part.startsWith('redirect=') && !part.startsWith('exp=')) {
      errors.push(`Invalid SPF mechanism: ${part}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Generate DMARC record
 */
export const generateDmarcRecord = (policy: Partial<DmarcPolicy>): string => {
  const parts: string[] = ['v=DMARC1'];

  parts.push(`p=${policy.policy || 'none'}`);

  if (policy.subdomain_policy) {
    parts.push(`sp=${policy.subdomain_policy}`);
  }

  if (policy.percentage !== undefined) {
    parts.push(`pct=${policy.percentage}`);
  }

  if (policy.rua && policy.rua.length > 0) {
    parts.push(`rua=${policy.rua.join(',')}`);
  }

  if (policy.ruf && policy.ruf.length > 0) {
    parts.push(`ruf=${policy.ruf.join(',')}`);
  }

  if (policy.alignment_spf) {
    parts.push(`aspf=${policy.alignment_spf === 'strict' ? 's' : 'r'}`);
  }

  if (policy.alignment_dkim) {
    parts.push(`adkim=${policy.alignment_dkim === 'strict' ? 's' : 'r'}`);
  }

  return parts.join('; ');
};

/**
 * Store DMARC report
 */
export const storeDmarcReport = async (report: {
  reportId: string;
  domain: string;
  reporterOrgName: string;
  dateRangeBegin: Date;
  dateRangeEnd: Date;
  sourceIp: string;
  count: number;
  disposition: string;
  dkimResult: string;
  spfResult: string;
  rawXml?: string;
}) => {
  const id = randomUUID();

  await dbQuery(
    `insert into dmarc_reports(
      id,
      report_id,
      domain,
      reporter_org_name,
      date_range_begin,
      date_range_end,
      source_ip,
      count,
      disposition,
      dkim_result,
      spf_result,
      raw_xml,
      created_at
    ) values($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      id,
      report.reportId,
      report.domain,
      report.reporterOrgName,
      report.dateRangeBegin,
      report.dateRangeEnd,
      report.sourceIp,
      report.count,
      report.disposition,
      report.dkimResult,
      report.spfResult,
      report.rawXml || null,
    ]
  );

  return id;
};

/**
 * Get DMARC reports
 */
export const getDmarcReports = async (params: {
  domain?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}) => {
  const limit = Math.max(1, Math.min(200, params.limit || 50));
  const offset = Math.max(0, params.offset || 0);

  let whereClause = 'where 1=1';
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (params.domain) {
    whereClause += ` and domain = $${paramIndex}`;
    queryParams.push(params.domain);
    paramIndex++;
  }

  if (params.startDate) {
    whereClause += ` and date_range_begin >= $${paramIndex}`;
    queryParams.push(params.startDate);
    paramIndex++;
  }

  if (params.endDate) {
    whereClause += ` and date_range_end <= $${paramIndex}`;
    queryParams.push(params.endDate);
    paramIndex++;
  }

  queryParams.push(limit, offset);

  const result = await dbQuery(
    `select
      id,
      report_id,
      domain,
      reporter_org_name,
      date_range_begin,
      date_range_end,
      source_ip,
      count,
      disposition,
      dkim_result,
      spf_result,
      created_at
    from dmarc_reports
    ${whereClause}
    order by created_at desc
    limit $${paramIndex}
    offset $${paramIndex + 1}`,
    queryParams
  );

  const totalResult = await dbQuery(
    `select count(*)::int as total from dmarc_reports ${whereClause}`,
    queryParams.slice(0, -2)
  );

  return {
    items: result.rows.map(row => ({
      id: String(row.id),
      reportId: String(row.report_id),
      domain: String(row.domain),
      reporterOrgName: String(row.reporter_org_name),
      dateRangeBegin: String(row.date_range_begin),
      dateRangeEnd: String(row.date_range_end),
      sourceIp: String(row.source_ip),
      count: Number(row.count),
      disposition: String(row.disposition),
      dkimResult: String(row.dkim_result),
      spfResult: String(row.spf_result),
      createdAt: String(row.created_at),
    })),
    total: Number(totalResult.rows[0]?.total || 0),
  };
};

/**
 * Calculate deliverability score
 */
export const calculateDeliverabilityScore = async (): Promise<DeliverabilityScore> => {
  const recommendations: string[] = [];
  let score = 100;

  // Check DKIM configuration
  const dkimConfig = getDkimConfig();
  const dkimConfigured = dkimConfig !== null;
  if (!dkimConfigured) {
    score -= 30;
    recommendations.push('Configure DKIM signing to improve email authentication');
  }

  // Check SPF (simulated - would need DNS lookup in production)
  const spfConfigured = !!appConfig.smtpHost;
  if (!spfConfigured) {
    score -= 20;
    recommendations.push('Configure SPF record for your domain');
  }

  // Check DMARC (simulated - would need DNS lookup in production)
  const dmarcConfigured = dkimConfigured && spfConfigured;
  if (!dmarcConfigured) {
    score -= 20;
    recommendations.push('Configure DMARC policy to protect your domain');
  }

  // Calculate bounce rate
  const bounceStats = await dbQuery(`
    select
      count(*) filter (where status = 'bounced')::int as bounced,
      count(*) filter (where status = 'sent')::int as sent
    from email_queue
    where created_at > now() - interval '30 days'
  `);

  const bounced = Number(bounceStats.rows[0]?.bounced || 0);
  const sent = Number(bounceStats.rows[0]?.sent || 0);
  const total = bounced + sent;
  const bounceRate = total > 0 ? (bounced / total) * 100 : 0;

  if (bounceRate > 5) {
    score -= 15;
    recommendations.push(`High bounce rate (${bounceRate.toFixed(2)}%) - clean your email list`);
  } else if (bounceRate > 2) {
    score -= 5;
    recommendations.push(`Moderate bounce rate (${bounceRate.toFixed(2)}%) - monitor email quality`);
  }

  // Complaint rate (simulated - would track actual complaints)
  const complaintRate = 0;

  if (score < 70) {
    recommendations.push('Your deliverability score is low - take action to improve it');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    dkimConfigured,
    spfConfigured,
    dmarcConfigured,
    bounceRate,
    complaintRate,
    recommendations,
  };
};

/**
 * Get deliverability statistics
 */
export const getDeliverabilityStats = async () => {
  const score = await calculateDeliverabilityScore();

  const emailStats = await dbQuery(`
    select
      count(*) filter (where status = 'sent')::int as sent,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'bounced')::int as bounced,
      count(*) filter (where status = 'pending')::int as pending
    from email_queue
    where created_at > now() - interval '30 days'
  `);

  const stats = emailStats.rows[0] || { sent: 0, failed: 0, bounced: 0, pending: 0 };

  return {
    score,
    last30Days: {
      sent: Number(stats.sent),
      failed: Number(stats.failed),
      bounced: Number(stats.bounced),
      pending: Number(stats.pending),
    },
  };
};

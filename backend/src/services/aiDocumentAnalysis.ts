import { callLLMWithFallback } from './aiService.js';
import { logger } from '../logger.js';
import { extractJson } from '../helpers/safeJsonParse.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
// pdf-parse loaded dynamically in extractTextFromPdf
import mammoth from 'mammoth';

export interface ExtractedDocumentInfo {
  documentType: string;
  contractNumber?: string;
  contractDate?: string;
  counterparty?: string;
  amount?: number;
  currency?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  paymentTerms?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  additionalInfo: Record<string, any>;
}

export interface FormAutoFillData {
  title?: string;
  description?: string;
  systemType?: string;
  priority?: string;
  tenantId?: string;
  amount?: number;
  dueDate?: string;
  [key: string]: any;
}

export interface OcrResult {
  text: string;
  confidence: number;
  language: string;
}

/**
 * Extract text from PDF file
 */
async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    const dataBuffer = await fs.readFile(filePath);
    // Dynamic import to handle pdf-parse module resolution issues
    const pdfModule = await import('pdf-parse').catch(() => null) as any;
    const pdfParse = pdfModule?.default || pdfModule;
    if (!pdfParse) {
      throw new Error('PDF parsing is not available - pdf-parse module could not be loaded');
    }
    const result = await (pdfParse as any)(dataBuffer);
    return result?.text || '';
  } catch (error) {
    logger.error('Error extracting text from PDF', { error, filePath });
    throw error;
  }
}

/**
 * Extract text from DOCX file
 */
async function extractTextFromDocx(filePath: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch (error) {
    logger.error('Error extracting text from DOCX', { error, filePath });
    throw error;
  }
}

/**
 * Extract text from TXT file
 */
async function extractTextFromTxt(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error('Error extracting text from TXT', { error, filePath });
    throw error;
  }
}

/**
 * Extract text from document based on file type
 */
export async function extractTextFromDocument(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await extractTextFromPdf(filePath);
    case '.docx':
    case '.doc':
      return await extractTextFromDocx(filePath);
    case '.txt':
      return await extractTextFromTxt(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Extract key information from contract document
 */
export async function extractContractInfo(
  documentText: string
): Promise<ExtractedDocumentInfo> {
  try {
    const systemPrompt = `You are an expert at analyzing contracts and extracting key information.
Extract all relevant details from the contract text and return as structured JSON.
Be precise and only extract information that is explicitly stated in the document.

Format:
{
  "documentType": "contract|invoice|agreement|other",
  "contractNumber": "string or null",
  "contractDate": "YYYY-MM-DD or null",
  "counterparty": "company name or null",
  "amount": number or null,
  "currency": "RUB|USD|EUR or null",
  "description": "brief description",
  "startDate": "YYYY-MM-DD or null",
  "endDate": "YYYY-MM-DD or null",
  "paymentTerms": "string or null",
  "contactPerson": "name or null",
  "contactPhone": "phone or null",
  "contactEmail": "email or null",
  "address": "address or null",
  "additionalInfo": {}
}`;

    const userPrompt = `Extract key information from this document:

${documentText.slice(0, 8000)}

Return the extracted information as JSON.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 2048,
      temperature: 0.1,
    });

    if (!aiResult.content) {
      logger.warn('AI contract extraction returned no content');
      return {
        documentType: 'unknown',
        additionalInfo: {},
      };
    }

    // Parse AI response
    const extracted = extractJson(aiResult.content, null as any);
    if (!extracted) {
      logger.warn('AI contract extraction returned invalid JSON');
      return {
        documentType: 'unknown',
        additionalInfo: {},
      };
    }
    return {
      documentType: extracted.documentType || 'unknown',
      contractNumber: extracted.contractNumber || undefined,
      contractDate: extracted.contractDate || undefined,
      counterparty: extracted.counterparty || undefined,
      amount: extracted.amount || undefined,
      currency: extracted.currency || undefined,
      description: extracted.description || undefined,
      startDate: extracted.startDate || undefined,
      endDate: extracted.endDate || undefined,
      paymentTerms: extracted.paymentTerms || undefined,
      contactPerson: extracted.contactPerson || undefined,
      contactPhone: extracted.contactPhone || undefined,
      contactEmail: extracted.contactEmail || undefined,
      address: extracted.address || undefined,
      additionalInfo: extracted.additionalInfo || {},
    };
  } catch (error) {
    logger.error('Error extracting contract info', { error });
    return {
      documentType: 'unknown',
      additionalInfo: {},
    };
  }
}

/**
 * Extract key information from invoice document
 */
export async function extractInvoiceInfo(
  documentText: string
): Promise<ExtractedDocumentInfo> {
  try {
    const systemPrompt = `You are an expert at analyzing invoices and extracting key information.
Extract all relevant details from the invoice text and return as structured JSON.
Be precise and only extract information that is explicitly stated in the document.

Format:
{
  "documentType": "invoice",
  "contractNumber": "invoice number",
  "contractDate": "YYYY-MM-DD",
  "counterparty": "vendor/supplier name",
  "amount": number,
  "currency": "RUB|USD|EUR",
  "description": "items/services description",
  "paymentTerms": "payment terms",
  "contactPerson": "name or null",
  "contactPhone": "phone or null",
  "contactEmail": "email or null",
  "address": "billing address or null",
  "additionalInfo": {
    "items": [],
    "taxAmount": number,
    "totalAmount": number
  }
}`;

    const userPrompt = `Extract key information from this invoice:

${documentText.slice(0, 8000)}

Return the extracted information as JSON.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 2048,
      temperature: 0.1,
    });

    if (!aiResult.content) {
      logger.warn('AI invoice extraction returned no content');
      return {
        documentType: 'invoice',
        additionalInfo: {},
      };
    }

    // Parse AI response
    const extracted = extractJson(aiResult.content, null as any);
    if (!extracted) {
      logger.warn('AI invoice extraction returned invalid JSON');
      return {
        documentType: 'invoice',
        additionalInfo: {},
      };
    }
    return {
      documentType: 'invoice',
      contractNumber: extracted.contractNumber || undefined,
      contractDate: extracted.contractDate || undefined,
      counterparty: extracted.counterparty || undefined,
      amount: extracted.amount || undefined,
      currency: extracted.currency || undefined,
      description: extracted.description || undefined,
      paymentTerms: extracted.paymentTerms || undefined,
      contactPerson: extracted.contactPerson || undefined,
      contactPhone: extracted.contactPhone || undefined,
      contactEmail: extracted.contactEmail || undefined,
      address: extracted.address || undefined,
      additionalInfo: extracted.additionalInfo || {},
    };
  } catch (error) {
    logger.error('Error extracting invoice info', { error });
    return {
      documentType: 'invoice',
      additionalInfo: {},
    };
  }
}

/**
 * Auto-fill form fields from extracted document information
 */
export async function autoFillFormFromDocument(
  documentInfo: ExtractedDocumentInfo,
  formType: 'service_request' | 'project' | 'contract'
): Promise<FormAutoFillData> {
  try {
    const systemPrompt = `You are an expert at mapping document information to form fields.
Given extracted document information and a form type, suggest appropriate values for form fields.
Return a JSON object with field names and suggested values.

Format:
{
  "title": "suggested title",
  "description": "suggested description",
  "systemType": "suggested system type or null",
  "priority": "low|medium|high|urgent or null",
  "amount": number or null,
  "dueDate": "YYYY-MM-DD or null"
}`;

    const userPrompt = `Document information:
${JSON.stringify(documentInfo, null, 2)}

Form type: ${formType}

Suggest appropriate values for form fields based on the document information.`;

    const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
      maxTokens: 1024,
      temperature: 0.2,
    });

    if (!aiResult.content) {
      logger.warn('AI form auto-fill returned no content');
      return {};
    }

    // Parse AI response
    const formData = extractJson<FormAutoFillData>(aiResult.content, {});
    return formData;
  } catch (error) {
    logger.error('Error auto-filling form from document', { error });
    return {};
  }
}

/**
 * Perform OCR on scanned document (simulated - would need actual OCR service)
 */
export async function performOcr(
  imageData: Buffer,
  language: string = 'rus'
): Promise<OcrResult> {
  try {
    // In a real implementation, this would call an OCR service like Tesseract, Google Vision API, etc.
    // For now, we'll simulate OCR by using AI to analyze the image description

    logger.info('OCR requested - would integrate with OCR service', { language });

    // Placeholder implementation
    return {
      text: '',
      confidence: 0,
      language,
    };
  } catch (error) {
    logger.error('Error performing OCR', { error });
    return {
      text: '',
      confidence: 0,
      language,
    };
  }
}

/**
 * Analyze document and extract all relevant information
 */
export async function analyzeDocument(
  filePath: string,
  documentType?: string
): Promise<ExtractedDocumentInfo> {
  try {
    // Extract text from document
    const text = await extractTextFromDocument(filePath);

    if (!text || text.trim().length === 0) {
      logger.warn('No text extracted from document', { filePath });
      return {
        documentType: 'unknown',
        additionalInfo: {},
      };
    }

    // Determine document type if not provided
    if (!documentType) {
      const systemPrompt = `You are an expert at classifying documents.
Analyze the text and determine the document type.
Return only one word: contract, invoice, agreement, specification, report, or other.`;

      const userPrompt = `Classify this document:

${text.slice(0, 2000)}`;

      const aiResult = await callLLMWithFallback(systemPrompt, userPrompt, {
        maxTokens: 50,
        temperature: 0.1,
      });

      documentType = aiResult.content?.toLowerCase().trim() || 'unknown';
    }

    // Extract information based on document type
    if (documentType === 'invoice') {
      return await extractInvoiceInfo(text);
    } else if (documentType === 'contract' || documentType === 'agreement') {
      return await extractContractInfo(text);
    } else {
      return await extractContractInfo(text);
    }
  } catch (error) {
    logger.error('Error analyzing document', { error, filePath });
    return {
      documentType: 'unknown',
      additionalInfo: {},
    };
  }
}

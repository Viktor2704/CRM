import * as React from 'react';
import { Text, Section, Button } from '@react-email/components';
import { BaseEmail } from './BaseEmail.js';

interface LoginTokenEmailProps {
  token: string;
  expiresInMinutes: number;
}

export const LoginTokenEmail = ({ token, expiresInMinutes }: LoginTokenEmailProps) => {
  return (
    <BaseEmail preheader={`Ваш код входа: ${token}`}>
      <Text style={headingStyle}>Код входа в систему</Text>
      <Text style={paragraphStyle}>
        Используйте код ниже для входа в систему Новинжстрой.
      </Text>

      <Section style={tokenContainerStyle}>
        <Text style={tokenLabelStyle}>Ваш код</Text>
        <Text style={tokenStyle}>{token}</Text>
      </Section>

      <Text style={expiryStyle}>
        Код действует <strong style={strongStyle}>{expiresInMinutes} минут</strong>
      </Text>
      <Text style={disclaimerStyle}>
        Если вы не запрашивали вход — просто проигнорируйте это письмо.
      </Text>
    </BaseEmail>
  );
};

const headingStyle = {
  margin: '0 0 8px',
  color: '#1E293B',
  fontSize: '22px',
  fontWeight: '700',
};

const paragraphStyle = {
  margin: '0 0 28px',
  color: '#475569',
  fontSize: '15px',
  lineHeight: '1.6',
};

const tokenContainerStyle = {
  textAlign: 'center' as const,
  margin: '0 0 28px',
  backgroundColor: '#F8FAFC',
  border: '2px solid #e11d48',
  borderRadius: '12px',
  padding: '24px 48px',
};

const tokenLabelStyle = {
  margin: '0 0 6px',
  color: '#64748B',
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '2px',
};

const tokenStyle = {
  margin: '0',
  color: '#1E293B',
  fontSize: '36px',
  fontWeight: '800',
  letterSpacing: '8px',
  fontFamily: "'Courier New', monospace",
};

const expiryStyle = {
  margin: '0 0 8px',
  color: '#64748B',
  fontSize: '13px',
  textAlign: 'center' as const,
};

const strongStyle = {
  color: '#e11d48',
};

const disclaimerStyle = {
  margin: '16px 0 0',
  color: '#94A3B8',
  fontSize: '12px',
  textAlign: 'center' as const,
};

export default LoginTokenEmail;

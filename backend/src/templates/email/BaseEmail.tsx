import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
} from '@react-email/components';

interface BaseEmailProps {
  preheader?: string;
  children?: React.ReactNode;
}

export const BaseEmail = ({ preheader, children }: BaseEmailProps) => {
  const currentYear = new Date().getFullYear();

  return (
    <Html lang="ru">
      <Head>
        <style>{`
          @media only screen and (max-width: 680px) {
            .email-container { width: 100% !important; max-width: 100% !important; }
            .email-body { padding: 24px 20px !important; font-size: 15px !important; }
            .email-header { padding: 22px 20px !important; }
            .email-footer { padding: 20px !important; }
          }
        `}</style>
      </Head>
      <Body style={bodyStyle}>
        {preheader && (
          <div style={preheaderStyle}>
            {preheader}
            {'&zwnj;&nbsp;'.repeat(30)}
          </div>
        )}
        <Container style={containerStyle}>
          <Section style={toplineStyle} />

          {/* Header */}
          <Section style={headerStyle}>
            <Text style={logoStyle}>НОВИНЖСТРОЙ</Text>
            <Text style={taglineStyle}>Инженерные системы безопасности</Text>
          </Section>

          {/* Body */}
          <Section style={contentStyle}>
            {children}
          </Section>

          <Hr style={dividerStyle} />

          {/* Footer */}
          <Section style={footerStyle}>
            <Text style={footerTextStyle}>
              <strong style={footerBoldStyle}>ООО «Новинжстрой»</strong><br />
              <Link href="tel:+74959220701" style={footerLinkStyle}>+7 (495) 922-07-01</Link><br />
              <Link href="mailto:info@novinzhstroy.ru" style={footerLinkStyle}>info@novinzhstroy.ru</Link>
            </Text>
            <Text style={footerCopyrightStyle}>
              &copy; {currentYear} Новинжстрой. Все права защищены.<br />
              <Link href="https://novinzhstroy.ru" style={footerLinkStyle}>novinzhstroy.ru</Link>
            </Text>
            <Text style={footerDisclaimerStyle}>
              Это автоматическое уведомление. Пожалуйста, не отвечайте на это письмо.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const bodyStyle = {
  margin: '0',
  padding: '0',
  backgroundColor: '#E7ECF3',
  fontFamily: "'Segoe UI', Arial, Helvetica, sans-serif",
};

const preheaderStyle = {
  display: 'none',
  fontSize: '1px',
  color: '#f1f1f1',
  lineHeight: '1px',
  maxHeight: '0',
  maxWidth: '0',
  opacity: 0,
  overflow: 'hidden',
};

const containerStyle = {
  maxWidth: '640px',
  margin: '34px auto',
  backgroundColor: '#FFFFFF',
  borderRadius: '16px',
  overflow: 'hidden',
  border: '1px solid #DCE3EE',
  boxShadow: '0 12px 36px rgba(15,23,42,0.14)',
};

const toplineStyle = {
  height: '5px',
  background: 'linear-gradient(90deg,#e11d48,#f43f5e,#fb7185)',
};

const headerStyle = {
  background: 'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)',
  padding: '30px 36px 28px',
};

const logoStyle = {
  color: '#FFFFFF',
  fontSize: '20px',
  fontWeight: '800',
  letterSpacing: '4px',
  margin: '0 0 5px',
};

const taglineStyle = {
  color: '#94a3b8',
  fontSize: '12px',
  letterSpacing: '0.4px',
  margin: '0',
};

const contentStyle = {
  padding: '36px 40px',
  color: '#1E293B',
  fontSize: '15px',
  lineHeight: '1.72',
};

const dividerStyle = {
  margin: '0 40px',
  borderColor: '#CBD5E1',
};

const footerStyle = {
  padding: '24px 40px 30px',
  backgroundColor: '#f8fafc',
};

const footerTextStyle = {
  color: '#64748B',
  fontSize: '12px',
  lineHeight: '1.62',
  margin: '0 0 12px',
};

const footerBoldStyle = {
  color: '#334155',
  fontSize: '13px',
};

const footerLinkStyle = {
  color: '#64748B',
  textDecoration: 'none',
};

const footerCopyrightStyle = {
  color: '#94A3B8',
  fontSize: '11px',
  lineHeight: '1.58',
  margin: '0 0 8px',
};

const footerDisclaimerStyle = {
  color: '#94A3B8',
  fontSize: '11px',
  lineHeight: '1.5',
  margin: '0',
};

export default BaseEmail;

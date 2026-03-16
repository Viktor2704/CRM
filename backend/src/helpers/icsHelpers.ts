import { randomUUID } from 'node:crypto';
import { normalizeText } from './normalize.js';

export const formatIcsDate = (input) => {
    const dateValue = new Date(input);
    if (Number.isNaN(dateValue.getTime())) {
        return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }
    return dateValue.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
};
export const escapeIcsText = (value) => String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
export const generateIcsEvent = (params) => {
    const uid = normalizeText(params?.uid) || randomUUID();
    const summary = escapeIcsText(params?.summary);
    const description = escapeIcsText(params?.description);
    const location = escapeIcsText(params?.location);
    const dtstart = params?.dtstart ? new Date(params.dtstart) : new Date();
    const dtendInput = params?.dtend
        ? new Date(params.dtend)
        : new Date(dtstart.getTime() + 3600000);
    const dtstartDate = Number.isNaN(dtstart.getTime()) ? new Date() : dtstart;
    const dtendDate = Number.isNaN(dtendInput.getTime())
        ? new Date(dtstartDate.getTime() + 3600000)
        : dtendInput;
    return [
        'BEGIN:VEVENT',
        `UID:${uid}@novinzhstroy.ru`,
        `DTSTART:${formatIcsDate(dtstartDate)}`,
        `DTEND:${formatIcsDate(dtendDate)}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${location}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
    ].join('\r\n');
};
export const wrapIcsCalendar = (eventsContent) => [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Novinzhstroy//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    eventsContent,
    'END:VCALENDAR',
].join('\r\n');
export const sendIcsResponse = (response, icsContent, filename) => {
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.status(200).send(icsContent);
};

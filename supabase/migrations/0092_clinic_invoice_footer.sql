-- Free-text note printed at the bottom of every invoice for this clinic
-- (payment terms, thank-you note, etc.) -- plain text with line breaks
-- preserved on render, not rich text.
alter table clinics add column invoice_footer_text text;

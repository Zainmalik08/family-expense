-- Rebuild all entries from the full story (replaces everything entered before).
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.

delete from public.paybacks;
delete from public.money_in;
delete from public.expenses;

-- Treatment money received
insert into public.money_in (received_on, from_name, amount, note, returnable, received, created_at) values
  ('2026-10-30', 'Family', 94000,  'Treatment money we left home with', false, true, '2026-10-30 08:00+05'),
  ('2026-11-01', 'Uzair',  8000,   'Gave 10,000; 2,000 went on food, not counted', false, true, '2026-11-01 08:00+05'),
  ('2026-11-03', 'Uzair',  210000, 'For discharge', false, true, '2026-11-03 08:00+05'),
  ('2026-11-06', 'Uzair',  190000, 'More treatment money for Mama', false, true, '2026-11-06 08:00+05');

-- Money paid back
insert into public.paybacks (paid_on, to_name, amount, note, from_cash, created_at) values
  ('2026-11-06', 'Zain', 55500, 'Zain took back his own money (3 days medicines)', true, '2026-11-06 09:00+05');

-- Expenses (source: cash = from the treatment money; person = someone's own pocket)
insert into public.expenses (spent_on, description, amount, category, source, paid_by, pay_back, created_at) values
  ('2026-10-30', 'Quaid-e-Azam Hospital (emergency and other costs)', 27000, 'Hospital bill', 'cash', null, false, '2026-10-30 10:00+05'),
  ('2026-10-30', 'PAF Hospital emergency admission', 15000, 'Hospital bill', 'person', 'Salman', true, '2026-10-30 11:00+05'),
  ('2026-10-30', 'PAF Hospital advance', 67000, 'Hospital bill', 'cash', null, false, '2026-10-30 12:00+05'),
  ('2026-11-03', 'PAF Hospital discharge bill (total bill 268,307 minus 82,000 advance)', 186307, 'Hospital bill', 'cash', null, false, '2026-11-03 10:00+05'),
  ('2026-11-03', 'Medicines, Shaheen Chemist (Moon Mamu), on the way back', 7000, 'Medicines', 'cash', null, false, '2026-11-03 11:00+05'),
  ('2026-11-04', 'Drip, Dar doctor (morning)', 600, 'Doctor & treatment', 'cash', null, false, '2026-11-04 08:00+05'),
  ('2026-11-04', 'Dr. Uzma Batool appointment, PAF Hospital', 3000, 'Doctor & treatment', 'cash', null, false, '2026-11-04 09:00+05'),
  ('2026-11-04', 'Medicines for 3 days', 55500, 'Medicines', 'person', 'Zain', true, '2026-11-04 10:00+05'),
  ('2026-11-04', 'CRP test, IDC', 2150, 'Lab tests', 'cash', null, false, '2026-11-04 11:00+05'),
  ('2026-11-05', 'Uzair took from the cash', 2000, 'Other', 'cash', null, false, '2026-11-05 10:00+05'),
  ('2026-11-05', 'Insulin for Baba', 1300, 'Medicines', 'cash', null, false, '2026-11-05 11:00+05'),
  ('2026-11-06', 'Medicines, pharmacy', 107700, 'Medicines', 'cash', null, false, '2026-11-06 10:00+05'),
  ('2026-11-06', 'Remaining medicines, Neechay wali market, Gulzar-e-Quaid', 1700, 'Medicines', 'cash', null, false, '2026-11-06 11:00+05'),
  ('2026-11-07', 'New cannula', 350, 'Doctor & treatment', 'cash', null, false, '2026-11-07 10:00+05'),
  ('2026-11-07', 'Cannula fitting charges', 200, 'Doctor & treatment', 'cash', null, false, '2026-11-07 10:30+05');

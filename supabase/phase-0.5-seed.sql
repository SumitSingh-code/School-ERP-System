-- Synthetic tenant-isolation fixtures only. Safe to run repeatedly.
INSERT INTO "School" ("id", "name") VALUES
  ('phase05-demo-school-a', 'Synthetic Isolation School A'),
  ('phase05-demo-school-b', 'Synthetic Isolation School B')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Student" ("id", "schoolId", "admissionNo", "fullName", "status") VALUES
  ('phase05-demo-student-a', 'phase05-demo-school-a', 'SYNTH-A-0001', 'Synthetic Student A', 'ACTIVE'),
  ('phase05-demo-student-b', 'phase05-demo-school-b', 'SYNTH-B-0001', 'Synthetic Student B', 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;

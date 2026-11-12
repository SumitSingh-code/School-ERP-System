export function normalizeAttendanceDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function teacherCanMarkForDate(input: { classTeacher: boolean; substitute: boolean; date: string; today: string }) {
  return input.classTeacher || (input.substitute && input.date === input.today);
}

export function attendanceViewStatus(submissionExists: boolean) {
  return submissionExists ? "SUBMITTED" as const : "NOT_SUBMITTED" as const;
}

export function parentAttendanceStatus(submissionExists: boolean, recordStatus: "ABSENT" | "LATE" | null) {
  if (!submissionExists) return "NOT_MARKED_YET" as const;
  return recordStatus ?? "PRESENT" as const;
}

export function attendanceNotificationCopy(studentName: string, date: string) {
  return {
    en: { title: "Attendance update", body: `${studentName} was marked absent on ${date}. If this is unexpected, please contact the school.` },
    hi: { title: "उपस्थिति की जानकारी", body: `${studentName} को ${date} को अनुपस्थित दर्ज किया गया है। यदि यह सही नहीं है, तो कृपया स्कूल से संपर्क करें।` },
  };
}

export function defaultAttendanceTemplates(schoolId: string) {
  const absent = attendanceNotificationCopy("{{studentName}}", "{{date}}");
  return [
    { schoolId, eventType: "ATTENDANCE_ABSENT", language: "en", channel: "IN_APP", title: absent.en.title, body: absent.en.body },
    { schoolId, eventType: "ATTENDANCE_ABSENT", language: "hi", channel: "IN_APP", title: absent.hi.title, body: absent.hi.body },
    { schoolId, eventType: "ATTENDANCE_LATE_CORRECTION", language: "en", channel: "IN_APP", title: "Attendance correction", body: "{{studentName}} arrived late on {{date}}; please ignore the earlier absence message." },
    { schoolId, eventType: "ATTENDANCE_LATE_CORRECTION", language: "hi", channel: "IN_APP", title: "उपस्थिति में सुधार", body: "{{studentName}} आज देर से पहुँचे हैं; कृपया पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।" },
    { schoolId, eventType: "ATTENDANCE_PENDING", language: "en", channel: "IN_APP", title: "Attendance reminder", body: "Please submit attendance for {{sectionName}} for {{date}}." },
    { schoolId, eventType: "ATTENDANCE_PENDING", language: "hi", channel: "IN_APP", title: "उपस्थिति अनुस्मारक", body: "कृपया {{date}} के लिए {{sectionName}} की उपस्थिति जमा करें।" },
    { schoolId, eventType: "ATTENDANCE_ESCALATION", language: "en", channel: "IN_APP", title: "Attendance pending", body: "Attendance for {{sectionName}} is still not submitted for {{date}}." },
    { schoolId, eventType: "ATTENDANCE_ESCALATION", language: "hi", channel: "IN_APP", title: "उपस्थिति बाकी है", body: "{{date}} के लिए {{sectionName}} की उपस्थिति अभी जमा नहीं हुई है।" },
    { schoolId, eventType: "SCHOOL_HOLIDAY", language: "en", channel: "IN_APP", title: "School closed today", body: "School is closed today ({{date}}): {{reason}}." },
    { schoolId, eventType: "SCHOOL_HOLIDAY", language: "hi", channel: "IN_APP", title: "आज स्कूल बंद है", body: "आज ({{date}}) स्कूल बंद है: {{reason}}।" },
    { schoolId, eventType: "ATTENDANCE_VOIDED_FOR_HOLIDAY", language: "en", channel: "IN_APP", title: "Attendance correction", body: "School is closed on {{date}}. Please ignore the earlier absence message for {{studentName}}." },
    { schoolId, eventType: "ATTENDANCE_VOIDED_FOR_HOLIDAY", language: "hi", channel: "IN_APP", title: "उपस्थिति में सुधार", body: "{{date}} को स्कूल बंद है। कृपया {{studentName}} के लिए पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।" },
  ];
}

export function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (token, key: string) => values[key] ?? token);
}

type SubjectSeed = { name: string; code: string; optional?: boolean };

const subjectsByClass: Record<string, SubjectSeed[]> = {
  NC: ["English", "Hindi", "Maths", "EVS / General Awareness", "Art and Craft", "Rhymes and Story", "Play / PE"].map((name, i) => ({ name, code: `NC-${String(i + 1).padStart(2, "0")}` })),
  LKG: ["English", "Hindi", "Maths", "EVS / General Awareness", "Art and Craft", "Rhymes and Story", "Play / PE"].map((name, i) => ({ name, code: `LKG-${String(i + 1).padStart(2, "0")}` })),
  UKG: ["English", "Hindi", "Maths", "EVS / General Awareness", "Art and Craft", "Rhymes and Story", "Play / PE"].map((name, i) => ({ name, code: `UKG-${String(i + 1).padStart(2, "0")}` })),
  "1": ["English", "Hindi", "Maths", "EVS", "Computer", "GK", "Art and Craft", "PE", "Moral Science"].map((name, i) => ({ name, code: `C1-${String(i + 1).padStart(2, "0")}` })),
  "2": ["English", "Hindi", "Maths", "EVS", "Computer", "GK", "Art and Craft", "PE", "Moral Science"].map((name, i) => ({ name, code: `C2-${String(i + 1).padStart(2, "0")}` })),
  "3": ["English", "Hindi", "Maths", "EVS", "Computer", "GK", "Art", "PE", "Moral Science"].map((name, i) => ({ name, code: `C3-${String(i + 1).padStart(2, "0")}` })),
  "4": ["English", "Hindi", "Maths", "EVS", "Computer", "GK", "Art", "PE", "Moral Science"].map((name, i) => ({ name, code: `C4-${String(i + 1).padStart(2, "0")}` })),
  "5": ["English", "Hindi", "Maths", "EVS", "Computer", "GK", "Art", "PE", "Moral Science"].map((name, i) => ({ name, code: `C5-${String(i + 1).padStart(2, "0")}` })),
  "6": ["English", "Hindi", "Maths", "Science", "Social Science", "Sanskrit", "Computer", "GK", "Art", "PE"].map((name, i) => ({ name, code: `C6-${String(i + 1).padStart(2, "0")}` })),
  "7": ["English", "Hindi", "Maths", "Science", "Social Science", "Sanskrit", "Computer", "GK", "Art", "PE"].map((name, i) => ({ name, code: `C7-${String(i + 1).padStart(2, "0")}` })),
  "8": ["English", "Hindi", "Maths", "Science", "Social Science", "Sanskrit", "Computer", "GK", "Art", "PE"].map((name, i) => ({ name, code: `C8-${String(i + 1).padStart(2, "0")}` })),
  "9": ["English", "Hindi", "Maths", "Science", "Social Science", "IT / Computer", "PE"].map((name, i) => ({ name, code: `C9-${String(i + 1).padStart(2, "0")}` })),
  "10": ["English", "Hindi", "Maths", "Science", "Social Science", "IT / Computer", "PE"].map((name, i) => ({ name, code: `C10-${String(i + 1).padStart(2, "0")}` })),
};

const seniorSubjects: Record<string, SubjectSeed[]> = {
  Arts: ["English", "History", "Political Science", "Geography", "Economics", "Hindi", "PE"].map((name, i) => ({ name, code: `ART-${String(i + 1).padStart(2, "0")}`, optional: i >= 4 })),
  Commerce: ["English", "Accountancy", "Business Studies", "Economics", "Maths", "Informatics Practices", "PE"].map((name, i) => ({ name, code: `COM-${String(i + 1).padStart(2, "0")}`, optional: i >= 4 })),
  "Science PCM": ["English", "Physics", "Chemistry", "Maths", "Computer Science", "PE"].map((name, i) => ({ name, code: `PCM-${String(i + 1).padStart(2, "0")}`, optional: i >= 4 })),
  "Science PCB": ["English", "Physics", "Chemistry", "Biology", "Computer Science", "PE"].map((name, i) => ({ name, code: `PCB-${String(i + 1).padStart(2, "0")}`, optional: i >= 4 })),
  "Science PCMB": ["English", "Physics", "Chemistry", "Maths", "Biology"].map((name, i) => ({ name, code: `PCMB-${String(i + 1).padStart(2, "0")}` })),
};

export const DEFAULT_CLASS_LEVELS = ["NC", "LKG", "UKG", ...Array.from({ length: 12 }, (_, index) => String(index + 1))];
export const DEFAULT_STREAMS = ["Arts", "Commerce", "Science"];
export const DEFAULT_GROUPS = ["PCM", "PCB", "PCMB"];

export function defaultSubjectsFor(className: string, streamName?: string, groupName?: string): SubjectSeed[] {
  if (Number(className) < 11 || !streamName) return subjectsByClass[className] ?? [];
  const key = streamName === "Science" && groupName ? `Science ${groupName}` : streamName;
  return seniorSubjects[key] ?? [];
}

export function academicYearFor(today = new Date()) {
  const year = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { label: `${year}-${String(year + 1).slice(-2)}`, startsOn: new Date(Date.UTC(year, 3, 1)), endsOn: new Date(Date.UTC(year + 1, 2, 31)) };
}

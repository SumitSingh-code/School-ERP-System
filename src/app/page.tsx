const cards = [
  ["Attendance", "Not marked yet", "Check section submissions"],
  ["Fees collected today", "₹ 0", "Collections appear after finance entry"],
  ["Pending approvals", "0", "Tests, fee drafts and concessions"],
];

export default function Home() {
  return <main className="min-h-screen bg-[#f5f7f4] text-slate-900">
    <header className="flex items-center justify-between border-b bg-white px-5 py-4 md:px-10"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-emerald-800">School ERP</p><h1 className="text-xl font-bold">School dashboard</h1></div><button className="min-h-12 rounded-xl border px-4 font-medium">Switch role</button></header>
    <section className="mx-auto max-w-6xl px-5 py-8 md:px-10"><p className="text-sm text-slate-600">Monday · Academic year 2026–27</p><h2 className="mt-2 text-3xl font-bold">Good morning</h2><p className="mt-2 text-slate-600">Your school overview will appear here.</p>
      <div className="mt-7 grid gap-4 md:grid-cols-3">{cards.map(([title, value, note]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="font-medium text-slate-600">{title}</p><p className="mt-3 text-2xl font-bold">{value}</p><p className="mt-2 text-sm text-slate-500">{note}</p></article>)}</div>
      <article className="mt-6 rounded-2xl bg-emerald-950 p-6 text-white"><p className="text-sm text-emerald-100">Phase 0 preview</p><h3 className="mt-1 text-xl font-semibold">A calm, mobile-first workspace</h3><p className="mt-2 max-w-2xl text-sm text-emerald-100">Role-based dashboards, attendance, fees and notices will be enabled phase by phase.</p></article>
    </section><nav className="fixed inset-x-0 bottom-0 grid grid-cols-4 border-t bg-white p-2 text-center text-xs md:hidden">{["Home","Attendance","Fees","Notices"].map(x=><span key={x} className="p-3">{x}</span>)}</nav>
  </main>;
}

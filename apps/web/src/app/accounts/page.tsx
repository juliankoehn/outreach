"use client";
import { useEffect, useState } from "react";

interface Account { id: string; displayName: string; status: string }

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [log, setLog] = useState("");

  async function load() {
    const res = await fetch("/api/linkedin/accounts", { credentials: "include" });
    if (res.ok) setAccounts(((await res.json()) as { accounts: Account[] }).accounts);
  }
  useEffect(() => { void load(); }, []);

  async function ingest(id: string) {
    const res = await fetch(`/api/linkedin/accounts/${id}/ingest`, { method: "POST", credentials: "include" });
    setLog(await res.text());
  }
  async function importCsv(id: string, file: File) {
    const res = await fetch(`/api/linkedin/accounts/${id}/import`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "text/csv" }, body: await file.text(),
    });
    setLog(await res.text());
  }

  return (
    <main>
      <h1>LinkedIn accounts</h1>
      <p><a href="/api/linkedin/connect">+ Connect LinkedIn</a></p>
      <ul>
        {accounts.map((a) => (
          <li key={a.id}>
            {a.displayName} ({a.status})
            <button onClick={() => ingest(a.id)}>Ingest via API</button>
            <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && importCsv(a.id, e.target.files[0])} />
          </li>
        ))}
      </ul>
      <pre>{log}</pre>
    </main>
  );
}

"use client";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function submit(kind: "sign-in" | "sign-up") {
    const res = await fetch(`/api/api/auth/${kind}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    });
    setMsg(res.ok ? "OK — go to /accounts" : `Error ${res.status}`);
  }

  return (
    <main>
      <h1>Sign in</h1>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div>
        <button onClick={() => submit("sign-in")}>Sign in</button>
        <button onClick={() => submit("sign-up")}>Sign up</button>
      </div>
      <p>{msg}</p>
    </main>
  );
}

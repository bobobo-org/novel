'use client';

import { useState } from 'react';

export function SignInForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [email, setEmail] = useState('');

  return (
    <form className="auth-form" action={action}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        required
      />
      <button type="submit">寄送登入連結</button>
    </form>
  );
}

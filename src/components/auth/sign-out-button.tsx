'use client';

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button className="ghost-button" type="submit">
        登出
      </button>
    </form>
  );
}

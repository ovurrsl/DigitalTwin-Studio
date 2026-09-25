import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="font-semibold text-3xl">DigitalTwin Studio</h1>
      <Link
        className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent"
        href="/editor"
      >
        Open editor
      </Link>
    </main>
  )
}

const configuredBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export interface GotoTarget {
  x: number
  y: number
  z: number
}

export function apiUrl(path: string, base = configuredBase): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export async function spawnDrone(
  fetcher: typeof fetch = fetch,
  base = configuredBase,
): Promise<{ id: number }> {
  const response = await fetcher(apiUrl('/spawn', base), {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Spawn failed with status ${response.status}`)
  }

  return response.json()
}

export async function sendGotoCommand(
  id: number,
  target: GotoTarget,
  fetcher: typeof fetch = fetch,
  base = configuredBase,
): Promise<void> {
  const response = await fetcher(apiUrl('/goto', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...target }),
  })

  if (!response.ok) {
    throw new Error(`GOTO failed with status ${response.status}`)
  }
}

export async function sendKillCommand(
  id: number,
  fetcher: typeof fetch = fetch,
  base = configuredBase,
): Promise<void> {
  const response = await fetcher(apiUrl('/kill', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })

  if (!response.ok) {
    throw new Error(`Kill failed with status ${response.status}`)
  }
}

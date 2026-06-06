const configuredBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export function apiUrl(path: string, base = configuredBase): string {
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export async function spawnDrone(
  password: string,
  fetcher: typeof fetch = fetch,
  base = configuredBase,
): Promise<{ id: number }> {
  const response = await fetcher(apiUrl('/spawn', base), {
    method: 'POST',
    headers: { 'X-Spawn-Password': password },
  })

  if (!response.ok) {
    throw new Error(`Spawn failed with status ${response.status}`)
  }

  return response.json()
}

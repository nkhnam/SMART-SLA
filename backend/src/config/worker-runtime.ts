export function workersEnabled(): boolean {
  return process.env.WORKERS_ENABLED !== "false";
}

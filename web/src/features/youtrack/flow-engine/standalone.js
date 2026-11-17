// ------------------------------------------------------------------ standalone helpers
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  return { s: q.get("s"), m: q.get("m") };
}

export { readHash };

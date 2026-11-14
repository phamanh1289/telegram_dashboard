// Synthetic only: no ticket text, screenshots or provider data.
export function flowDataset(count: 5 | 20 | 60) {
  const screens = Array.from({ length: count }, (_, i) => ({
    id: `s${i}`, title: `Màn ${i}`, kind: i === 2 ? "popup" : "screen", parent: i === 2 ? "s1" : null,
    zeplin: `https://app.zeplin.io/project/${"a".repeat(24)}/screen/${i.toString(16).padStart(24, "0")}`,
    ac: "AC synthetic", items: [{ id: "next", label: "Tiếp tục" }, { id: "other", label: "Tiếp tục" },
      { id: "missing", label: "Không khớp ảnh" }],
  }));
  const links = Array.from({ length: Math.min(300, count * 5) }, (_, i) => ({
    src: `s${i % (count - 1)}.${i % 2 ? "next" : "other"}`, to: `s${(i * 3 + 1) % (count - 1)}`,
    act: i % 4 ? "navigate" : "back", when: `Nhánh ${i}`, ac: "AC synthetic",
  }));
  links[0] = { ...links[0], src: "s1.next", to: "s2", act: "open" };
  const shots = Object.fromEntries(screens.slice(0, -1).map((s, i) => [s.zeplin, {
    src: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="${i === 0 ? 4000 : 844}"><rect width="390" height="100%" fill="white"/><text x="10" y="40">Synthetic ${i}</text></svg>`),
    w: 390, h: i === 0 ? 4000 : 844,
    hits: [["Tiếp tục", 10, 100, 160, 40], ["Tiếp tục", 10, 160, 160, 40]],
  }]));
  return { flow: { v: 1 as const, ticket: "SYNTHETIC-1", rev: 0, device: "mobile", screens, links }, shots };
}
export const legacyDataset = { ticket: "SYNTHETIC-OLD", screens: [{ id: "old", title: "Cũ", items: [] }], links: [] };
export const malformedDataset = { v: 1, screens: [null, { id: "dup", items: [] }, { id: "dup", items: [null] }], links: [{ src: "missing", to: "absent" }, null] };

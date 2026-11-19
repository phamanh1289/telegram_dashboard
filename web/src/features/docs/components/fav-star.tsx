"use client";

import { Star } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { type Doc, useDocFavs } from "@/features/docs/lib/docs";

/** Yêu thích: a document's star (the reader's title, a list row on hover), filled yellow when starred, kept per browser.
 *  `quiet`: a row's, shown on the row's hover / focus only until starred (the row is `group/row`). */
export function FavStar({ doc, quiet }: { doc: Pick<Doc, "source" | "ref">; quiet?: boolean }) {
  const t = useT();
  const favs = useDocFavs();
  const on = favs.has(doc);
  return (
    <Hint side="bottom" text={on ? t("Bỏ khỏi Yêu thích") : t("Thêm vào Yêu thích để mở lại nhanh")}>
      <Button size="icon-xs" variant="ghost" aria-pressed={on} aria-label={t("Đánh dấu yêu thích")} onClick={() => favs.toggle(doc)}
        className={cn("shrink-0 aria-pressed:bg-transparent hover:text-fav", on ? "text-fav aria-pressed:text-fav" : "text-ink-3",
          quiet && !on && "opacity-0 transition-opacity duration-(--dur-micro) group-hover/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100")}>
        <Star className={cn("transition-[scale,fill] duration-(--dur-short) ease-(--ease-out)", on && "scale-110 fill-current")} />
      </Button>
    </Hint>
  );
}

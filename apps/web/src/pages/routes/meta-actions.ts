/** Meta writes shared by the Greenhouse and the home isle: buy an item, buy a plot, with the book and HUD updated. */
import { type CatalogItem, stampDef } from "@pl/shared";
import type { Services } from "../../app/services.js";

/** Buys one catalog item, applies the result to the meta book and the simulated balance, and toasts new stamps. */
export async function buyCatalogItem(s: Services, item: CatalogItem): Promise<void> {
  const res = await s.api.buyItem(item.id);
  s.meta.applyBuy(res);
  if (res.simRfMicro !== undefined) s.identity.updateOwner({ balanceMicro: res.simRfMicro });
  s.audio.play("ui.confirm");
  s.toast(`${item.name} bought.`, "good");
  for (const id of res.stamps) s.toast(`New stamp: ${stampDef(id)?.name ?? id}!`, "good");
}

/** Buys the next isle plot with Bits. */
export async function buyIslePlot(s: Services): Promise<void> {
  const res = await s.api.buyPlot();
  s.meta.applyPlot(res);
  s.toast(`New terrace! Your isle has ${res.terraces} now.`, "good");
}

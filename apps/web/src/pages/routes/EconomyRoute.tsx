/** `/economy`: every price, the odds and the running totals (`GET /api/stats/economy`). */
import { type PageProps, useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { EconomyPage } from "../EconomyPage.js";

/** `/economy` */
export default function EconomyRoute(_props: PageProps) {
  const { api } = useServices();
  const id = useIdentity();
  const stats = useRemote(() => api.economyStats(), []);
  const mode = id.mode === "owner" ? id.economy : stats.value.status === "ready" ? stats.value.data.mode : "sim";
  return <EconomyPage mode={mode} stats={stats.value} onRetryStats={stats.retry} />;
}

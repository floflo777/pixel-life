/** `/about`: how to play. */
import type { PageProps } from "../../app/hooks.js";
import { navigate } from "../../lib/router.js";
import { AboutPage } from "../AboutPage.js";

/** `/about` */
export default function AboutRoute(_props: PageProps) {
  return <AboutPage onPlay={() => navigate("/play")} onOpenEconomy={() => navigate("/economy")} />;
}

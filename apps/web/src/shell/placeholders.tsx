import type { RouteDef } from "../app/routes.js";
import { Card, LinkButton } from "../ui/kit.js";

/** Rendered for a registered `pages` route whose page file has not landed yet. */
export function PagePending({ route }: { route: RouteDef }) {
  return (
    <div className="page">
      <Card title={route.title}>
        <p>This screen is on its way. The sky is still being built.</p>
        <LinkButton to="/sky">back to the sky</LinkButton>
      </Card>
    </div>
  );
}

/** 404 inside the shell. */
export function NotFound({ path }: { path: string }) {
  return (
    <div className="page">
      <Card title="Lost in the clouds">
        <p className="mono">
          nothing at <code>{path}</code>
        </p>
        <LinkButton to="/">home</LinkButton>
      </Card>
    </div>
  );
}

import { Card, LinkButton } from "../ui/index.js";

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

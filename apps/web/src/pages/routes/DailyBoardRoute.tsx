/** `/board`: today's seed (`GET /api/daily`) and the owners / visitors boards (`GET /api/daily/:day/board`). */
import type { BoardKind, DailyBoardRes } from "@pl/shared";
import { type PageProps, useRemote, useServices } from "../../app/hooks.js";
import { href } from "../../app/routes.js";
import { navigate } from "../../lib/router.js";
import type { Remote } from "../../ui/index.js";
import { DailyBoard } from "../DailyBoard.js";

/** `/board?board=owners|visitors` */
export default function DailyBoardRoute({ search }: PageProps) {
  const { api } = useServices();
  const board: BoardKind = search.get("board") === "visitors" ? "visitors" : "owners";
  const daily = useRemote(() => api.daily(), []);
  const day = daily.value.status === "ready" ? daily.value.data.day : null;
  const data = useRemote(async () => (day === null ? null : api.board(day, board)), [day, board]);
  // The board waits for today's seed; a failed seed read is the board's error (retry re-reads the seed).
  const value: Remote<DailyBoardRes> =
    daily.value.status === "error"
      ? daily.value
      : data.value.status === "error"
        ? data.value
        : data.value.status === "ready" && data.value.data && data.value.data.board === board
          ? { status: "ready", data: data.value.data }
          : { status: "loading" };
  return (
    <DailyBoard
      seed={daily.value.status === "ready" ? daily.value.data : null}
      board={board}
      onBoardChange={(b) => navigate(href("board", {}, { board: b }), { replace: true })}
      data={value}
      onRetry={() => (day === null ? daily.retry() : data.retry())}
      onPlay={() => navigate(href("play", {}, { mode: "daily" }))}
      onOpenFriend={(t) => navigate(`/f/${t}`)}
    />
  );
}

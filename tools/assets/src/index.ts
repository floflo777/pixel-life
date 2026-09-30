/** @pl/assets: baked asset formats. Consumers import `@pl/assets/loaners.json` and parse it with `parseLoaners`. */
export {
  LOANERS,
  LOANERS_FORMAT,
  LOANERS_MAX_BYTES,
  encodeLoaners,
  parseLoaners,
  stringifyLoaners,
  verifyAgainstDesign,
  type LoanerFriend,
  type LoanersFile,
  type VerifyReport,
} from "./loaners.js";

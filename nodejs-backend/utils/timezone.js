/**
 * Timezone validation, by CONSTRUCTION rather than against a list.
 *
 * `Intl.supportedValuesOf("timeZone")` returns whatever names the linked ICU
 * build considers canonical, and that set is both incomplete and version-
 * dependent. On this runtime it rejects every one of these, all of which are
 * valid IANA zones that browsers really do emit from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`:
 *
 *   Asia/Kolkata       (ICU offers the legacy alias Asia/Calcutta)
 *   Asia/Ho_Chi_Minh   (Asia/Saigon)
 *   Asia/Yangon        (Asia/Rangoon)
 *   Europe/Kyiv        (Europe/Kiev)
 *   UTC                (an alias, not a zone, so it is never listed)
 *
 * `Asia/Kolkata` is the one that matters most: it is what an Indian user's
 * browser sends, this product's primary market, and the enum turned it into a
 * 400 with a 417-name message the user could not act on. "UTC" had the same
 * problem from the other side — it is the schedule schema's own declared
 * default, so a client echoing the default back was rejected by it.
 *
 * Constructing a DateTimeFormat accepts canonical names and aliases alike and
 * cannot drift as ICU updates, so it is both broader and more stable than any
 * list we could pin.
 *
 * Lives here rather than in one validator because BOTH front doors now take a
 * timezone — the autopilot schedule form and the Quick setup brief — and they
 * must accept exactly the same set. Two copies of this check would eventually
 * disagree, and the disagreement would show up as a brief that validates on
 * creation and then fails at activation.
 */

/** @returns {boolean} true when Intl can actually resolve the name. */
function isKnownTimezone(value) {
  if (!value || typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Joi `.custom()` adapter over the same check. */
const joiTimezone = (value, helpers) =>
  isKnownTimezone(value)
    ? value
    : helpers.error("any.invalid", { message: `"${value}" is not a known timezone` });

module.exports = { isKnownTimezone, joiTimezone };

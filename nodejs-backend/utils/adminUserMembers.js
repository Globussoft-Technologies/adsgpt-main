function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function buildMemberIndexes(members = []) {
  const byId = new Map();
  const byEmail = new Map();
  members.forEach((member) => {
    const memberId = String(member?.memberId || "").trim();
    if (memberId) byId.set(memberId, member);
    const email = normalizeEmail(member?.email);
    if (email && !byEmail.has(email)) byEmail.set(email, member);
  });
  return { byId, byEmail };
}

function findMember(profile = {}, indexes) {
  const explicitId = String(profile.amember_user_id || "").trim();
  if (explicitId && indexes.byId.has(explicitId)) return indexes.byId.get(explicitId);

  const localId = String(profile.user_id || "").trim();
  const derivedId = /^GPT-(\d+)$/.exec(localId)?.[1];
  if (derivedId && indexes.byId.has(derivedId)) return indexes.byId.get(derivedId);

  const email = normalizeEmail(profile.email);
  return email ? indexes.byEmail.get(email) || null : null;
}

function enrichRows(rows, profileMap, members = []) {
  const indexes = buildMemberIndexes(members);
  return rows.map((row) => {
    const profile = profileMap.get(row.userId) || {
      user_id: row.userId,
      email: row.email,
    };
    const member = findMember(profile, indexes);
    return {
      ...row,
      contactNo: member?.contactNo || null,
      signUpDate: member?.signUpDate || null,
    };
  });
}

function isInSignupRange(signUpDate, from, to) {
  if (!from && !to) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(signUpDate || ""))) return false;
  if (from && signUpDate < from) return false;
  if (to && signUpDate > to) return false;
  return true;
}

function filterBySignupRange(rows, from, to) {
  if (!from && !to) return rows;
  return rows.filter((row) => isInSignupRange(row.signUpDate, from, to));
}

function applyMemberData({
  rows,
  profileMap,
  members = [],
  signUpFrom = "",
  signUpTo = "",
  available = true,
}) {
  const enrichedRows = enrichRows(rows, profileMap, members);
  const signupFilterRequested = Boolean(signUpFrom || signUpTo);
  const signupFilterApplied = signupFilterRequested && available;

  return {
    rows: signupFilterApplied
      ? filterBySignupRange(enrichedRows, signUpFrom, signUpTo)
      : enrichedRows,
    signupFilterRequested,
    signupFilterApplied,
  };
}

// Ties need a deterministic tiebreaker: most users sit at 0 cost/generations, and
// without one their relative order falls back to the unsorted Mongo natural order
// of the profile query. That order can shift between the separate requests that
// fetch page 1 and page 2, which silently duplicates some users and hides others.
function compareUserRows(sortField) {
  return (a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    const delta =
      sortField === "lastActivity"
        ? new Date(bv).getTime() - new Date(av).getTime()
        : bv - av;
    if (delta) return delta;
    return String(a.userId).localeCompare(String(b.userId));
  };
}

function paginateRows(rows, page, limit) {
  const skip = (page - 1) * limit;
  const data = rows.slice(skip, skip + limit);
  return {
    data,
    total: rows.length,
    hasMore: skip + data.length < rows.length,
  };
}

module.exports = {
  applyMemberData,
  buildMemberIndexes,
  compareUserRows,
  enrichRows,
  filterBySignupRange,
  findMember,
  isInSignupRange,
  normalizeEmail,
  paginateRows,
};

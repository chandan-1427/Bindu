/**
 * Gmail-shape compact date for thread rows.
 *
 *   today      → "3:47 PM"
 *   yesterday  → "Yesterday"
 *   this week  → "Mon"
 *   this year  → "May 14"
 *   older      → "5/14/24"
 *
 * Returns the fallback string when the ISO can't be parsed, so mock data
 * without `at` still renders something.
 */
export function formatListDate(iso?: string, fallback = ""): string {
	if (!iso) return fallback;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return fallback || iso;
	const now = new Date();

	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) {
		return d.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit",
		});
	}

	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

	const daysDiff = Math.floor(
		(now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
	);
	if (daysDiff < 7 && daysDiff >= 0) {
		return d.toLocaleDateString(undefined, { weekday: "short" });
	}

	if (d.getFullYear() === now.getFullYear()) {
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}

	return d.toLocaleDateString(undefined, {
		month: "numeric",
		day: "numeric",
		year: "2-digit",
	});
}

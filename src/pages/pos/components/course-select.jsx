// course-select.jsx — per-ticket-line dropdown for assigning a kitchen course.
//
// Renders a compact <select> pill on each new (unsent) item row. The parent
// manages which courses are available (loaded once per location) and passes
// them down as `courses`. Calling `onChange(courseId | null)` lets the parent
// store the choice on the ticket line item.
//
// Columns used from the `courses` table:
//   id, name, sort_order, fire_on_previous_course_bumped
//
// If `courses` is empty or still loading, the dropdown is hidden so the row
// layout is not disrupted.

/* eslint-disable react/prop-types */
import { cn } from '@/lib/utils';

/**
 * @param {object}   props
 * @param {string}   [props.courseId]     - currently assigned course id (or null)
 * @param {Array}    [props.courses]      - [{id, name, sort_order}] for this location
 * @param {Function} props.onChange       - (courseId: string | null) => void
 * @param {string}   [props.className]
 */
export default function CourseSelect({ courseId, courses = [], onChange, className }) {
  if (!courses || courses.length === 0) return null;

  return (
    <select
      value={courseId || ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label="Assign course"
      className={cn(
        'text-[10px] font-semibold rounded-full border px-2 py-0.5 bg-card',
        'border-primary/25 text-primary focus:outline-none focus:border-primary/60',
        'cursor-pointer hover:bg-primary/10 transition',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">No course</option>
      {[...courses]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </select>
  );
}

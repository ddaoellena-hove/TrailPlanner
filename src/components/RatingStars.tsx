import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const STARS = [1, 2, 3, 4, 5];

/** Note d'une rando. Recliquer sur la note actuelle la retire. */
export function RatingStars({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange?: (rating: number | undefined) => void;
}) {
  const star = (rating: number) => (
    <Star
      className={cn(
        'size-4 text-muted-foreground',
        rating <= (value ?? 0) && 'fill-yellow-500 text-yellow-500',
      )}
      aria-hidden
    />
  );
  if (!onChange) {
    return (
      <span className="flex" role="img" aria-label={`Note : ${value ?? 0} sur 5`}>
        {STARS.map((rating) => (
          <span key={rating}>{star(rating)}</span>
        ))}
      </span>
    );
  }
  return (
    <span className="flex gap-0.5">
      {STARS.map((rating) => (
        <button
          key={rating}
          type="button"
          aria-label={`Noter ${rating} sur 5`}
          aria-pressed={value === rating}
          onClick={() => onChange(value === rating ? undefined : rating)}
        >
          {star(rating)}
        </button>
      ))}
    </span>
  );
}

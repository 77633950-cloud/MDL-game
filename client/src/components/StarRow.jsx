export function StarRow({ stars = 0, max = 3, size = 'md', compact = false }) {
  return (
    <span className={`stars stars-${size} ${compact ? 'stars-compact' : ''}`} aria-label={`${stars} 星`}>
      {Array.from({ length: max }).map((_, index) => (
        <span key={index} className={index < stars ? 'star on' : 'star'}>★</span>
      ))}
    </span>
  )
}

import type { MovieCard as Movie } from "@/lib/chat";

export function MovieCard({ movie }: { movie: Movie }) {
  return (
    <article className="card">
      {movie.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={movie.posterUrl} alt={`${movie.title} poster`} loading="lazy" />
      ) : (
        <div className="poster-placeholder" aria-hidden />
      )}
      <div className="card-body">
        <h3>
          {movie.title} {movie.year && <span className="year">({movie.year})</span>}
        </h3>
        <p className="rating">★ {movie.rating.toFixed(1)}</p>
        <p>{movie.why}</p>
        {movie.providers.length > 0 && (
          <p className="providers">
            Watch on:{" "}
            {movie.providers.map((p) => (
              <span key={p} className="tag">{p}</span>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}

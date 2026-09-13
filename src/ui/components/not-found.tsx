interface NotFoundProps {
  title: string;
  detail: string;
}

export function NotFound({ title, detail }: NotFoundProps) {
  return (
    <div className="flex flex-col items-start gap-2 p-8">
      <h1 className="font-display text-xl text-ink">{title}</h1>
      <p className="text-graphite">{detail}</p>
    </div>
  );
}

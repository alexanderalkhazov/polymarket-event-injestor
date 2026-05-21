interface SkeletonProps { width?: string | number; height?: string | number; radius?: number }

export function Skeleton({ width = "100%", height = 16, radius = 4 }: SkeletonProps) {
  return (
    <div className="skeleton" style={{ width, height, borderRadius: radius }} />
  )
}

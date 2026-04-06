export type RatingRecord = {
  id: string
  providerResultId: string
  score: number // 1-5
  tags: string[]
  note?: string
  createdAt: string
}

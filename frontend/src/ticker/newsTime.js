// "1H AGO" / "3D AGO" from an ESPN article's published timestamp; '' when unknown.
export function newsAgo(published) {
  const t = Date.parse(published || '')
  if (!t) return ''
  const hours = Math.max(1, Math.round((Date.now() - t) / 3600000))
  return hours < 24 ? `${hours}H AGO` : `${Math.round(hours / 24)}D AGO`
}

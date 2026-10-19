export function likeBadge(value,esc){
  return `<span class="like-count" aria-label="点赞 ${esc(value??'未提供')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>${esc(value??'—')}</span></span>`;
}

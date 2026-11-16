const ARCHIVE = 'https://archive.org'
const CC0 = 'http://creativecommons.org/publicdomain/zero/1.0/'
const BASE_QUERY = `mediatype:movies AND collection:feature_films AND licenseurl:"${CC0}"`
const state = { search: '', genre: '', sort: 'downloads desc', page: 1, loading: false, movies: [], source: 'archive', youtubeNextPage: null }
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'
const YOUTUBE_KEY_STORAGE = 'layar_youtube_api_key'
let youtubeApiKey = ''

let activeRequest

const grid = document.querySelector('#movie-grid')
const statusMessage = document.querySelector('#status-message')
const resultsTitle = document.querySelector('#results-title')
const resultsCount = document.querySelector('#results-count')
const loadMoreButton = document.querySelector('#load-more')
const searchForm = document.querySelector('#search-form')
const searchInput = document.querySelector('#search-input')
const searchToggle = document.querySelector('#search-toggle')
const dialog = document.querySelector('#player-dialog')
const video = document.querySelector('#film-video')
const playerStatus = document.querySelector('#player-status')
const playerTitle = document.querySelector('#player-title')
const playerDescription = document.querySelector('#player-description')
const sourcePage = document.querySelector('#source-page')
const archiveViews = document.querySelector('#archive-views')
const archiveRating = document.querySelector('#archive-rating')
const archiveReviewsCount = document.querySelector('#archive-reviews-count')
const archiveReviewsList = document.querySelector('#archive-reviews-list')
const youtubePlayer = document.querySelector('#youtube-player')
const archiveCommunity = document.querySelector('#archive-community')
const playerKicker = document.querySelector('#player-kicker')
const playerFooterNote = document.querySelector('#player-footer-note')
const catalogSourceLink = document.querySelector('#catalog-source-link')
const youtubeKeyPanel = document.querySelector('#youtube-key-panel')
const youtubeKeyForm = document.querySelector('#youtube-key-form')
const youtubeKeyInput = document.querySelector('#youtube-api-key')


function formatCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('id-ID') : '—'
}
function renderArchiveStats(movie) {
  archiveViews.textContent = '—'
  archiveRating.textContent = movie?.avg_rating ? `★ ${Number(movie.avg_rating).toFixed(1)}` : '—'
  archiveReviewsCount.textContent = formatCount(movie?.num_reviews ?? 0)
  archiveReviewsList.replaceChildren()
  const loading = document.createElement('p')
  loading.className = 'archive-reviews-empty'
  loading.textContent = 'Mengambil ulasan dari Internet Archive…'
  archiveReviewsList.append(loading)
}
async function loadArchiveViews(movies) {
  const identifiers = movies.map((movie) => movie.identifier).filter(Boolean)
  if (!identifiers.length) return
  // Views API accepts comma-separated item identifiers; simple GET only.
  for (let offset = 0; offset < identifiers.length; offset += 40) {
    const batch = identifiers.slice(offset, offset + 40)
    try {
      const response = await fetch(`https://be-api.us.archive.org/views/v1/short/${batch.map(encodeURIComponent).join(',')}`)
      if (!response.ok) continue
      const payload = await response.json()
      batch.forEach((identifier) => {
        const value = payload?.[identifier]?.all_time
        const card = grid.querySelector(`[data-movie-card="${CSS.escape(identifier)}"] .movie-views-value`)
        if (card && Number.isFinite(Number(value))) card.textContent = formatCount(value)
      })
    } catch { /* Statistik views mungkin sementara tidak tersedia. */ }
  }
}
function renderArchiveReviews(reviews) {
  archiveReviewsList.replaceChildren()
  const entries = Array.isArray(reviews) ? reviews : Object.values(reviews || {})
  if (!entries.length) {
    const empty = document.createElement('p')
    empty.className = 'archive-reviews-empty'
    empty.textContent = 'Belum ada ulasan publik untuk film ini di Internet Archive.'
    archiveReviewsList.append(empty)
    return
  }
  entries.slice(0, 12).forEach((review) => {
    const item = document.createElement('article')
    item.className = 'archive-review-item'
    const top = document.createElement('div')
    top.className = 'archive-review-top'
    const author = document.createElement('strong')
    author.textContent = review.reviewer || 'Pengguna Internet Archive'
    const stars = document.createElement('span')
    const score = Number(review.stars || 0)
    stars.textContent = score > 0 ? `${'★'.repeat(Math.min(score, 5))}${'☆'.repeat(Math.max(0, 5-score))}` : 'Tanpa rating'
    stars.className = 'archive-review-stars'
    top.append(author, stars)
    const title = document.createElement('h4')
    title.textContent = review.reviewtitle || 'Ulasan'
    const body = document.createElement('p')
    body.textContent = review.reviewbody || ''
    const date = document.createElement('time')
    date.textContent = review.reviewdate || review.createdate || ''
    item.append(top, title, body, date)
    archiveReviewsList.append(item)
  })
}


function youtubeKey() {
  return youtubeApiKey || localStorage.getItem(YOUTUBE_KEY_STORAGE) || ''
}
function setSource(source) {
  state.source = source
  document.querySelectorAll('.source-switch-button').forEach((button) => {
    const active = button.dataset.source === source
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  youtubeKeyPanel.hidden = source !== 'youtube'
  catalogSourceLink.href = source === 'youtube' ? 'https://www.youtube.com/results?search_query=creative+commons+full+movie' : 'https://archive.org/details/feature_films'
  catalogSourceLink.innerHTML = source === 'youtube' ? 'Sumber: Layar <span aria-hidden="true">↗</span>' : 'Sumber: Internet Archive <span aria-hidden="true">↗</span>'
  resultsTitle.textContent = source === 'youtube' ? 'Video panjang · Creative Commons' : 'Pilihan dari arsip'
  state.page = 1
  state.youtubeNextPage = null
  fetchMovies(false)
}
function parseIsoDuration(value) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value || '')
  if (!match) return 0
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
}
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}j ${m}m` : `${m} menit`
}
function youtubeSearchQuery() {
  const base = state.search ? `${state.search} full movie` : 'full length feature film'
  return state.genre ? `${base} ${state.genre}` : base
}
async function fetchYoutubeMovies(append = false) {
  const key = youtubeKey()
  if (!key) {
    grid.replaceChildren()
    statusMessage.textContent = 'Masukkan Layar API Key pada panel di atas untuk mulai mencari film.'
    resultsCount.textContent = 'API key diperlukan'
    loadMoreButton.hidden = true
    return
  }
  setLoading(true)
  statusMessage.textContent = append ? 'Memuat video berikutnya…' : 'Mencari film di Layar…'
  if (!append) showSkeletons()
  try {
    const params = new URLSearchParams({
      key, part:'snippet', type:'video', q:youtubeSearchQuery(),
      maxResults:'18', order:'relevance', videoDuration:'long',
      videoEmbeddable:'true', videoLicense:'creativeCommon',
      regionCode:'ID', relevanceLanguage:'id'
    })
    if (append && state.youtubeNextPage) params.set('pageToken', state.youtubeNextPage)
    const response = await fetch(`${YOUTUBE_API}/search?${params}`)
    const payload = await response.json()
    if (!response.ok) {
      const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || 'unknown'
      const apiMessage = payload?.error?.message || `Layar API HTTP ${response.status}`
      throw new Error(`${response.status} · ${reason} · ${apiMessage}`)
    }
    const items = (payload.items || []).filter(item => item.id?.videoId)
    const ids = items.map(item => item.id.videoId).join(',')
    let details = {}
    if (ids) {
      const detailParams = new URLSearchParams({key, part:'contentDetails,status,statistics', id:ids})
      const detailResponse = await fetch(`${YOUTUBE_API}/videos?${detailParams}`)
      const detailPayload = await detailResponse.json()
      if (!detailResponse.ok) {
        const reason = detailPayload?.error?.errors?.[0]?.reason || detailPayload?.error?.status || 'unknown'
        throw new Error(`${detailResponse.status} · ${reason} · ${detailPayload?.error?.message || 'Gagal mengambil detail video'}`)
      }
      details = Object.fromEntries((detailPayload.items || []).map(item => [item.id,item]))
    }
    const movies = items.map(item => {
      const detail = details[item.id.videoId] || {}
      const seconds = parseIsoDuration(detail.contentDetails?.duration)
      return {
        identifier:item.id.videoId, title:item.snippet?.title || 'Video tanpa judul',
        year:item.snippet?.publishedAt?.slice(0,4) || '',
        creator:item.snippet?.channelTitle || 'Kanal Layar',
        description:item.snippet?.description || '',
        thumbnail:item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        duration:seconds, views:detail.statistics?.viewCount || '—',
        avg_rating:null, num_reviews:0, source:'youtube',
        embeddable:detail.status?.embeddable === true,
        license:detail.status?.license || 'unknown'
      }
    }).filter(movie => movie.duration >= 20*60 && movie.embeddable && movie.license === 'creativeCommon')
    state.youtubeNextPage = payload.nextPageToken || null
    renderYoutubeMovies(movies, append)
    resultsCount.textContent = `${movies.length} video cocok`
    if (!movies.length) statusMessage.textContent = 'Belum ada video yang cocok dengan filter: durasi minimal 20 menit, bisa di-embed, dan Creative Commons. Coba kata kunci atau kategori lain.'
  } catch (error) {
    grid.replaceChildren()
    const message = document.createElement('p')
    message.className = 'empty-state'
    const strong = document.createElement('strong')
    strong.textContent = 'Layar API tidak dapat dimuat'
    const span = document.createElement('span')
    const detail = error.message
    if (/keyInvalid|keyExpired/i.test(detail)) {
      span.textContent = 'API Key tidak valid atau sudah kedaluwarsa.'
    } else if (/accessNotConfigured|SERVICE_DISABLED/i.test(detail)) {
      span.textContent = 'Layar Data API v3 belum aktif pada project yang memiliki API Key ini. Aktifkan API pada project yang sama.'
    } else if (/referer|ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED/i.test(detail)) {
      span.textContent = 'Domain GitHub Pages tidak cocok dengan HTTP referrer yang diizinkan.'
    } else if (/quotaExceeded|dailyLimitExceeded/i.test(detail)) {
      span.textContent = 'Kuota Layar API habis untuk hari ini. Search.list menggunakan 100 unit per permintaan. Coba lagi setelah kuota direset.'
    } else {
      span.textContent = `${detail}. Periksa Layar Data API v3, API restrictions, dan HTTP referrer GitHub Pages.`
    }
    message.append(strong,span)
    grid.append(message)
    statusMessage.textContent = 'Periksa API key, pembatasan domain, dan status Layar Data API v3.'
    resultsCount.textContent = 'Gagal memuat'
    loadMoreButton.hidden = true
  } finally { setLoading(false) }
}
function renderYoutubeMovies(movies, append=false) {
  if (!append) state.movies = []
  state.movies.push(...movies)
  if (!append) grid.replaceChildren()
  const fragment = document.createDocumentFragment()
  movies.forEach((movie,index) => {
    const article = document.createElement('article')
    article.className = 'movie-card'
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'poster-button'
    button.dataset.identifier = movie.identifier
    button.dataset.title = movie.title
    const image = document.createElement('img')
    image.src = movie.thumbnail; image.alt = `Thumbnail ${movie.title}`; image.loading = 'lazy'
    const overlay = document.createElement('span'); overlay.className = 'poster-overlay'
    const play = document.createElement('span'); play.className = 'play-circle'; play.textContent = '▶'
    const label = document.createElement('span'); label.className = 'quick-watch'; label.textContent = 'TONTON DI LAYAR'
    overlay.append(play,label)
    const badge = document.createElement('span'); badge.className = 'youtube-card-badge'; badge.textContent = 'CC · LAYAR'
    button.append(image,overlay,badge)
    const info = document.createElement('div'); info.className='movie-info'
    const title = document.createElement('h4'); title.textContent=movie.title
    const meta = document.createElement('p'); meta.textContent=[movie.year,movie.creator,formatDuration(movie.duration)].filter(Boolean).join(' · ')
    const stats = document.createElement('div'); stats.className='movie-api-stats'
    const views = document.createElement('span'); views.textContent=`▶ ${Number(movie.views).toLocaleString('id-ID')} views`
    stats.append(views); info.append(title,meta,stats); article.append(button,info)
    fragment.append(article)
  })
  grid.append(fragment)
  if (!append && movies[0]) {
    const first=movies[0]
    document.querySelector('#feature-image').src=first.thumbnail
    document.querySelector('#feature-image').alt=`Thumbnail ${first.title}`
    document.querySelector('#feature-title').textContent=first.title
    document.querySelector('#feature-meta').textContent=[first.year,first.creator].filter(Boolean).join(' · ')
    document.querySelector('#feature-index').textContent=`01 / ${String(movies.length).padStart(2,'0')}`
    const featurePlay=document.querySelector('#feature-play')
    featurePlay.dataset.identifier=first.identifier; featurePlay.dataset.title=first.title
  }
  statusMessage.textContent = movies.length ? '' : 'Tidak ada hasil yang cocok.'
  loadMoreButton.hidden = !state.youtubeNextPage
  loadMoreButton.disabled = false
  loadMoreButton.textContent = 'Muat film lainnya ↓'
}

function escapeLucene(value) {
  return value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, '\\$&')
}

function buildSearchUrl() {
  const clauses = [BASE_QUERY]
  if (state.genre) clauses.push(`subject:"${escapeLucene(state.genre)}"`)
  if (state.search) clauses.push(`title:"${escapeLucene(state.search)}"`)

  const params = new URLSearchParams({
    q: clauses.join(' AND '),
    output: 'json',
    rows: '18',
    page: String(state.page),
    'sort[]': state.sort,
  })
  for (const field of ['identifier', 'title', 'year', 'description', 'creator', 'licenseurl', 'downloads', 'avg_rating', 'num_reviews']) {
    params.append('fl[]', field)
  }
  return `${ARCHIVE}/advancedsearch.php?${params}`
}

function setLoading(isLoading) {
  state.loading = isLoading
  grid.setAttribute('aria-busy', String(isLoading))
  loadMoreButton.disabled = isLoading
  loadMoreButton.textContent = isLoading ? 'Memuat…' : 'Muat film lainnya ↓'
}

function showSkeletons() {
  grid.replaceChildren(...Array.from({ length: 8 }, () => {
    const card = document.createElement('div')
    card.className = 'skeleton'
    card.setAttribute('aria-hidden', 'true')
    return card
  }))
}

function creatorName(movie) {
  return Array.isArray(movie.creator) ? movie.creator[0] : movie.creator
}

function posterButton(movie, position) {
  const button = document.createElement('button')
  button.className = 'poster-button'
  button.type = 'button'
  button.dataset.identifier = movie.identifier
  button.dataset.title = movie.title || 'Film tanpa judul'
  button.setAttribute('aria-label', `Putar ${button.dataset.title}`)

  const fallback = document.createElement('span')
  fallback.className = 'poster-fallback'
  const fallbackTitle = document.createElement('span')
  fallbackTitle.textContent = movie.title || 'Film klasik'
  const fallbackLabel = document.createElement('span')
  fallbackLabel.textContent = 'KOLEKSI INTERNET ARCHIVE'
  fallback.append(fallbackTitle, fallbackLabel)

  const image = document.createElement('img')
  image.src = `${ARCHIVE}/services/img/${encodeURIComponent(movie.identifier)}`
  image.alt = `Poster ${movie.title || 'film klasik'}`
  image.loading = 'lazy'
  image.addEventListener('error', () => image.remove(), { once: true })

  const overlay = document.createElement('span')
  overlay.className = 'poster-overlay'
  const play = document.createElement('span')
  play.className = 'play-circle'
  play.setAttribute('aria-hidden', 'true')
  play.textContent = '▶'
  const label = document.createElement('span')
  label.className = 'quick-watch'
  label.textContent = 'PUTAR FILM'
  overlay.append(play, label)

  const number = document.createElement('span')
  number.className = 'poster-number'
  number.setAttribute('aria-hidden', 'true')
  number.textContent = String(position).padStart(2, '0')
  const license = document.createElement('span')
  license.className = 'license-badge'
  license.textContent = 'CC0*'
  license.title = 'Lisensi CC0 tercantum oleh pengunggah'

  button.append(fallback, image, overlay, number, license)
  return button
}

function movieCard(movie, position) {
  const article = document.createElement('article')
  article.className = 'movie-card'
  article.append(posterButton(movie, position))

  const info = document.createElement('div')
  info.className = 'movie-info'
  const titleLine = document.createElement('div')
  titleLine.className = 'movie-title-line'
  const title = document.createElement('h4')
  title.textContent = movie.title || 'Film tanpa judul'
  titleLine.append(title)
  const metadata = document.createElement('p')
  const details = [movie.year, creatorName(movie)].filter(Boolean)
  metadata.textContent = details.join(' · ') || 'Film klasik'
  info.append(titleLine, metadata)
  article.dataset.movieCard = movie.identifier
  const stats = document.createElement('div')
  stats.className = 'movie-api-stats'
  const views = document.createElement('span')
  views.innerHTML = '<b class="movie-views-value">—</b> dilihat'
  const rating = document.createElement('span')
  rating.textContent = movie.avg_rating ? `★ ${Number(movie.avg_rating).toFixed(1)}` : '★ —'
  const reviews = document.createElement('span')
  reviews.textContent = `💬 ${formatCount(movie.num_reviews ?? 0)}`
  stats.append(views, rating, reviews)
  info.append(stats)
  article.append(info)
  return article
}

function updateFeature(movie) {
  if (!movie) return
  document.querySelector('#feature-image').src = `${ARCHIVE}/services/img/${encodeURIComponent(movie.identifier)}`
  document.querySelector('#feature-image').alt = `Poster ${movie.title || 'film pilihan'}`
  document.querySelector('#feature-title').textContent = movie.title || 'Pilihan dari arsip'
  document.querySelector('#feature-meta').textContent = [movie.year, creatorName(movie)].filter(Boolean).join(' · ') || 'Internet Archive'
  document.querySelector('#feature-index').textContent = `01 / ${String(state.movies.length || 18).padStart(2, '0')}`
  document.querySelector('#feature-play').dataset.identifier = movie.identifier
  document.querySelector('#feature-play').dataset.title = movie.title || 'Film pilihan'
}

function renderMovies(movies, append = false) {
  if (!append) state.movies = []
  state.movies.push(...movies)
  if (!append) grid.replaceChildren()
  const start = append ? state.movies.length - movies.length : 0
  const fragment = document.createDocumentFragment()
  movies.forEach((movie, index) => fragment.append(movieCard(movie, start + index + 1)))
  grid.append(fragment)
  loadArchiveViews(movies)

  if (!append && movies[0]) updateFeature(movies[0])
  const total = Number(window.archiveResultCount || 0)
  resultsCount.textContent = total ? `${total.toLocaleString('id-ID')} judul` : `${state.movies.length} judul`
  statusMessage.textContent = movies.length || append ? '' : 'Belum ada film yang cocok. Coba judul atau genre lain.'
  loadMoreButton.hidden = !movies.length || state.movies.length >= total
}

function renderError() {
  grid.replaceChildren()
  statusMessage.textContent = 'Koleksi tidak dapat dimuat saat ini. Periksa koneksi lalu coba lagi.'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.className = 'load-more'
  retry.textContent = 'Coba lagi'
  retry.addEventListener('click', () => fetchMovies(false), { once: true })
  grid.append(retry)
  resultsCount.textContent = 'Koneksi terputus'
  loadMoreButton.hidden = true
}

async function fetchMovies(append = false) {
  if (state.source === 'youtube') return fetchYoutubeMovies(append)
  activeRequest?.abort()
  activeRequest = new AbortController()
  setLoading(true)
  statusMessage.textContent = append ? 'Memuat judul berikutnya…' : 'Menghubungkan ke koleksi film…'
  if (!append) showSkeletons()

  try {
    const response = await fetch(buildSearchUrl(), { signal: activeRequest.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    const docs = payload?.response?.docs
    if (!Array.isArray(docs)) throw new Error('Format data arsip tidak dikenali')
    window.archiveResultCount = Number(payload.response.numFound || 0)
    renderMovies(docs, append)
    if (state.movies.length < window.archiveResultCount) loadMoreButton.hidden = false
  } catch (error) {
    if (error.name !== 'AbortError') renderError()
  } finally {
    setLoading(false)
  }
}

function updateResultsTitle() {
  if (state.search) resultsTitle.textContent = `Hasil pencarian: “${state.search}”`
  else if (state.genre) resultsTitle.textContent = `Film ${state.genre}`
  else resultsTitle.textContent = state.sort === 'publicdate desc' ? 'Baru ditambahkan' : 'Pilihan dari arsip'
}

function selectGenre(button) {
  document.querySelectorAll('.genre-chip').forEach((chip) => {
    const active = chip === button
    chip.classList.toggle('is-active', active)
    chip.setAttribute('aria-pressed', String(active))
  })
  state.genre = button.dataset.genre || ''
  state.search = ''
  searchInput.value = ''
  state.page = 1
  updateResultsTitle()
  fetchMovies(false)
}

async function playMovie(identifier, title) {
  if (!identifier) return
  if (state.source === 'youtube') {
    playerTitle.textContent = title || 'Film YouTube'
    const selectedVideo = state.movies.find((movie) => movie.identifier === identifier)
    playerDescription.textContent = selectedVideo ? `${selectedVideo.creator} · ${selectedVideo.year} · ${formatDuration(selectedVideo.duration)} · ${formatCount(selectedVideo.views)} views. Periksa deskripsi dan bukti hak/lisensi pada kanal sumber sebelum menganggap video ini sebagai film resmi.` : 'Video diputar melalui YouTube. Periksa keterangan dan informasi lisensi pada halaman sumber video.'
    playerKicker.textContent = 'Layar · CREATIVE COMMONS'
    archiveCommunity.hidden = true
    playerFooterNote.textContent = 'Pemutar resmi Layar. Iklan dan kontrol Layar tetap berlaku; lisensi CC perlu diverifikasi pada sumber.'
    sourcePage.href = `https://www.youtube.com/watch?v=${encodeURIComponent(identifier)}`
    video.pause(); video.removeAttribute('src'); video.hidden = true; video.load()
    youtubePlayer.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(identifier)}?autoplay=1&rel=0`
    youtubePlayer.hidden = false
    playerStatus.hidden = true
    renderArchiveStats(null)
    archiveViews.textContent = '—'; archiveRating.textContent = '—'; archiveReviewsCount.textContent = '—'
    archiveReviewsList.replaceChildren()
    dialog.showModal()
    return
  }
  youtubePlayer.src = ''; youtubePlayer.hidden = true
  playerKicker.textContent = 'INTERNET ARCHIVE · CC0 TERCANTUM'
  archiveCommunity.hidden = false
  playerFooterNote.textContent = 'Periksa informasi hak cipta pada sumber.'
  playerTitle.textContent = title || 'Memuat film…'
  playerDescription.textContent = ''
  playerStatus.textContent = 'Menyiapkan video…'
  playerStatus.hidden = false
  video.hidden = true
  video.removeAttribute('src')
  video.load()
  sourcePage.href = `${ARCHIVE}/details/${encodeURIComponent(identifier)}`
  dialog.showModal()

  try {
    const response = await fetch(`${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const item = await response.json()
    const matchingMovie = state.movies.find((movie) => movie.identifier === identifier) || {}
    renderArchiveStats(matchingMovie)
    try {
      const viewsResponse = await fetch(`https://be-api.us.archive.org/views/v1/short/${encodeURIComponent(identifier)}`)
      if (viewsResponse.ok) {
        const viewsPayload = await viewsResponse.json()
        const count = viewsPayload?.[identifier]?.all_time
        archiveViews.textContent = count == null ? '—' : formatCount(count)
      }
    } catch { archiveViews.textContent = '—' }
    renderArchiveReviews(item.reviews || {})
    const itemTitle = Array.isArray(item.metadata?.title) ? item.metadata.title[0] : item.metadata?.title
    const description = Array.isArray(item.metadata?.description) ? item.metadata.description[0] : item.metadata?.description
    const files = (item.files || [])
      .filter((file) => /mpeg4/i.test(file.format || '') && /\.(mp4|m4v)$/i.test(file.name || ''))
      .sort((first, second) => Number(first.size || Infinity) - Number(second.size || Infinity))
    playerTitle.textContent = itemTitle || title || 'Film dari arsip'
    playerDescription.textContent = description || ''

    if (!files.length) {
      playerStatus.textContent = 'Belum ada file video MPEG-4 yang kompatibel. Gunakan tautan sumber untuk melihat pilihan format.'
      const sourceLink = document.createElement('a')
      sourceLink.href = sourcePage.href
      sourceLink.target = '_blank'
      sourceLink.rel = 'noreferrer'
      sourceLink.textContent = 'Buka halaman film di Internet Archive'
      playerStatus.append(document.createElement('br'), sourceLink)
      return
    }

    const file = files[0]
    video.src = `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`
    video.hidden = false
    video.load()
    playerStatus.hidden = true
  } catch {
    playerStatus.textContent = 'Detail film tidak dapat dimuat. Buka halaman sumber untuk mencoba pemutaran di Internet Archive.'
    const sourceLink = document.createElement('a')
    sourceLink.href = sourcePage.href
    sourceLink.target = '_blank'
    sourceLink.rel = 'noreferrer'
    sourceLink.textContent = 'Buka halaman sumber'
    playerStatus.append(document.createElement('br'), sourceLink)
  }
}

searchToggle.addEventListener('click', () => {
  searchInput.focus()
  searchForm.classList.add('is-focused')
})

searchForm.addEventListener('submit', (event) => {
  event.preventDefault()
  searchForm.classList.remove('is-focused')
  state.search = searchInput.value.trim()
  state.genre = ''
  state.page = 1
  document.querySelectorAll('.genre-chip').forEach((chip) => {
    const active = !chip.dataset.genre
    chip.classList.toggle('is-active', active)
    chip.setAttribute('aria-pressed', String(active))
  })
  updateResultsTitle()
  fetchMovies(false)
})

document.querySelectorAll('.tab-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-button').forEach((tab) => {
      const active = tab === button
      tab.classList.toggle('is-active', active)
      tab.setAttribute('aria-pressed', String(active))
    })
    state.sort = button.dataset.sort
    state.page = 1
    updateResultsTitle()
    fetchMovies(false)
  })
})

document.querySelector('#genre-list').addEventListener('click', (event) => {
  const button = event.target.closest('.genre-chip')
  if (button) selectGenre(button)
})

grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-identifier]')
  if (button) playMovie(button.dataset.identifier, button.dataset.title)
})

document.querySelector('#feature-play').addEventListener('click', (event) => {
  const button = event.currentTarget
  playMovie(button.dataset.identifier, button.dataset.title)
})

loadMoreButton.addEventListener('click', () => {
  if (state.loading) return
  state.page += 1
  fetchMovies(true)
})

document.querySelector('#player-close').addEventListener('click', () => dialog.close())
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close()
})
dialog.addEventListener('close', () => {
  youtubePlayer.src = ''
  youtubePlayer.hidden = true
  video.pause()
  video.removeAttribute('src')
  video.load()
})


document.querySelectorAll('.source-switch-button').forEach(button => {
  button.addEventListener('click', () => setSource(button.dataset.source))
})
youtubeKeyForm.addEventListener('submit', event => {
  event.preventDefault()
  const value = youtubeKeyInput.value.trim()
  if (!value) return
  youtubeApiKey = value
  try { localStorage.setItem(YOUTUBE_KEY_STORAGE, value) } catch {}
  state.page = 1
  state.youtubeNextPage = null
  if (state.source !== 'youtube') setSource('youtube')
  else fetchMovies(false)
  youtubeKeyInput.value = ''
})
document.querySelector('#youtube-key-clear').addEventListener('click', () => {
  youtubeApiKey = ''
  try { localStorage.removeItem(YOUTUBE_KEY_STORAGE) } catch {}
  youtubeKeyInput.value = ''
  if (state.source === 'youtube') fetchMovies(false)
})
youtubeApiKey = (() => { try { return localStorage.getItem(YOUTUBE_KEY_STORAGE) || '' } catch { return '' } })()

fetchMovies(false)


// Tutup splash screen setelah 7 detik.
const splashScreen = document.querySelector('#splash-screen')
if (splashScreen) {
  window.setTimeout(() => {
    splashScreen.classList.add('is-hidden')
    window.setTimeout(() => splashScreen.remove(), 600)
  }, 7000)
}

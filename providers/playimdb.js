const PROVIDER_NAME = 'VaPlayer';
const BASE_API = 'https://streamdata.vaplayer.ru/api.php';
const TMDB_API_KEY = '6963eb725a04d103a71c0a3ee85155f9';

const HEADERS = {
  'Origin': 'https://nextgencloudfabric.com',
  'Referer': 'https://nextgencloudfabric.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

/**
 * Helper to fetch a URL with a default 10-second timeout and predefined headers
 */
async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = 10000;
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(timeoutMs)
    : null;

  const requestOptions = {
    ...options,
    headers: {
      ...HEADERS,
      ...(options?.headers || {})
    }
  };

  if (signal) {
    requestOptions.signal = signal;
  }

  return await fetch(url, requestOptions);
}

/**
 * Helper to execute a fetch request and return JSON
 */
async function fetchJson(url, options) {
  try {
    const response = await fetchWithTimeout(url, options || {});
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error(`[${PROVIDER_NAME}] Fetch Error: ${error}`);
    return null;
  }
}

/**
 * Resolves metadata (title, release year, duration) from the TMDB API
 */
async function getTmdbMetadata(tmdbId, mediaType, season, episode) {
  const defaultTitle = 'Unknown Title';
  let durationStr = mediaType === 'tv' ? '45 min' : '2h 00m';

  try {
    const typePath = mediaType === 'movie' ? 'movie' : 'tv';
    const tmdbUrl = `https://api.themoviedb.org/3/${typePath}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await fetch(tmdbUrl);

    if (!response.ok) {
      return { name: defaultTitle, year: 'N/A', duration: durationStr };
    }

    const json = await response.json();

    if (mediaType === 'movie' && json.runtime) {
      durationStr = `${json.runtime} min`;
    } else if (mediaType === 'tv') {
      const episodeUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epResponse = await fetch(episodeUrl);

      if (epResponse.ok) {
        const epJson = await epResponse.json();
        if (epJson.runtime) {
          durationStr = `${epJson.runtime} min`;
        } else if (json.episode_run_time && json.episode_run_time.length > 0) {
          durationStr = `${json.episode_run_time[0]} min`;
        }
      }
    }

    const name = json.title || json.name || defaultTitle;
    const releaseDate = json.release_date || json.first_air_date || '';
    const year = releaseDate.split('-')[0] || 'N/A';

    return { name, year, duration: durationStr };
  } catch (err) {
    return { name: defaultTitle, year: 'N/A', duration: durationStr };
  }
}

/**
 * Main entry point to fetch streaming sources
 * @param {string} id - TMDB Media ID
 * @param {string} type - 'movie', 'tv', or 'series'
 * @param {number|string} [season] - Season number (required for TV)
 * @param {number|string} [episode] - Episode number (required for TV)
 */
async function getStreams(id, type, season, episode) {
  const streams = [];

  try {
    const isTv = type === 'tv' || type === 'series';
    const mediaType = isTv ? 'tv' : 'movie';

    if (!id) {
      console.log(`[${PROVIDER_NAME}] Missing TMDB ID`);
      return streams;
    }

    const metadata = await getTmdbMetadata(id, mediaType, season, episode);
    let apiUrl = `${BASE_API}?id=${id}&type=${mediaType}`;

    if (isTv) {
      if (!season || !episode) return streams;
      apiUrl += `&season=${season}&episode=${episode}`;
    }

    console.log(`[${PROVIDER_NAME}] Requesting URL: ${apiUrl}`);
    const data = await fetchJson(apiUrl, { headers: HEADERS });

    if (
      data &&
      (data.status_code === 200 || data.status === 'success') &&
      data.data &&
      data.data.stream_urls
    ) {
      const fileName = String(data.data.file_name || '').toLowerCase();

      // Determine Resolution / Quality Labels
      let qualityLabel = '1080p FHD';
      let qualityCode = '1080P';

      if (fileName.includes('2160p') || fileName.includes('4k')) {
        qualityLabel = '4K UHD';
        qualityCode = '4K';
      } else if (fileName.includes('1080p')) {
        qualityLabel = '1080p FHD';
        qualityCode = '1080P';
      } else if (fileName.includes('720p')) {
        qualityLabel = '720p HD';
        qualityCode = '720P';
      }

      // Determine Audio Track Labels
      let audioLabel = 'Original-Audio';
      let audioTag = 'Original-Audio';

      if (fileName.includes('dual') || (fileName.includes('audio') && fileName.includes('english'))) {
        audioLabel = 'Dual-Audio';
        audioTag = 'Dual';
      } else if (fileName.includes('multi')) {
        audioLabel = 'Multi-Audio';
        audioTag = 'Multilingual';
      } else if (fileName.includes('hindi')) {
        audioLabel = 'Hindi-Audio';
        audioTag = 'Hindi';
      } else if (fileName.includes('english')) {
        audioLabel = 'English-Audio';
        audioTag = 'English';
      }

      const titleName = metadata.name || 'Unknown Title';
      const year = metadata.year || 'N/A';

      // Build Stream Objects for each stream URL returned
      data.data.stream_urls.forEach((streamUrl, index) => {
        const urlLower = streamUrl.toLowerCase();
        const serverName = `Server ${index + 1}`;

        let format = 'STREAM';
        if (urlLower.includes('.mp4')) format = 'MP4';
        if (urlLower.includes('.m3u8')) format = 'HLS';

        const providerHeader = `${PROVIDER_NAME} | ${qualityLabel} | ${audioLabel}`;
        const displayTitle = isTv
          ? `📺 ${titleName} - S${season}E${episode} (${year})`
          : `🎬 ${titleName} - ${year}`;

        const qualityInfo = `💎 ${qualityCode} | 🌍 ${audioTag}`;
        const streamDetails = `🎞️ ${format} | ⏱️ ${metadata.duration} | ${serverName}`;
        const formattedTitle = `${displayTitle}\n${qualityInfo}\n${streamDetails}`;

        const streamObj = {
          name: providerHeader,
          title: formattedTitle,
          url: streamUrl,
          quality: qualityCode.toLowerCase(),
          type: 'url',
          headers: HEADERS
        };

        // Attach Subtitles if available
        if (data.default_subs && Array.isArray(data.default_subs) && data.default_subs.length > 0) {
          streamObj.subtitles = data.default_subs.map(sub => ({
            id: sub.code || sub.lang,
            url: sub.url,
            lang: sub.lang
          }));
        }

        streams.push(streamObj);
      });
    }
  } catch (err) {
    console.log(`[${PROVIDER_NAME}] Error: ${err.message || err}`);
  }

  return streams;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
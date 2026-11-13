const PROVIDER_NAME = 'VaPlayer';
const BASE_API = 'https://streamdata.vaplayer.ru/api.php';
const TMDB_API_KEY = '6963eb725a04d103a71c0a3ee85155f9';

const HEADERS = {
  'Origin': 'https://nextgencloudfabric.com',
  'Referer': 'https://nextgencloudfabric.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

/**
 * Fetch helper with timeout and provider headers
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
 * Executes fetch and returns parsed JSON
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
 * Resolves TMDB metadata (title, release year, duration)
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
 * Nuvio Provider Entry Point
 * @param {string} tmdbId - TMDB ID (e.g. "872585")
 * @param {string} mediaType - "movie" or "tv"
 * @param {number|null} season - Season number for TV shows
 * @param {number|null} episode - Episode number for TV shows
 * @returns {Promise<Array>} Array of Nuvio stream objects
 */
async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];

  try {
    if (!tmdbId) {
      console.log(`[${PROVIDER_NAME}] Missing TMDB ID`);
      return streams;
    }

    const isTv = mediaType === 'tv' || mediaType === 'series';
    const typeKey = isTv ? 'tv' : 'movie';

    const metadata = await getTmdbMetadata(tmdbId, typeKey, season, episode);
    let apiUrl = `${BASE_API}?id=${tmdbId}&type=${typeKey}`;

    if (isTv) {
      if (!season || !episode) return streams;
      apiUrl += `&season=${season}&episode=${episode}`;
    }

    const data = await fetchJson(apiUrl, { headers: HEADERS });

    if (
      data &&
      (data.status_code === 200 || data.status === 'success') &&
      data.data &&
      data.data.stream_urls
    ) {
      const fileName = String(data.data.file_name || '').toLowerCase();

      // Resolution Labels
      let qualityLabel = '1080p FHD';
      let qualityCode = '1080p';

      if (fileName.includes('2160p') || fileName.includes('4k')) {
        qualityLabel = '4K UHD';
        qualityCode = '4k';
      } else if (fileName.includes('1080p')) {
        qualityLabel = '1080p FHD';
        qualityCode = '1080p';
      } else if (fileName.includes('720p')) {
        qualityLabel = '720p HD';
        qualityCode = '720p';
      }

      // Audio Track Labels
      let audioTag = 'Original Audio';
      if (fileName.includes('dual') || (fileName.includes('audio') && fileName.includes('english'))) {
        audioTag = 'Dual Audio';
      } else if (fileName.includes('multi')) {
        audioTag = 'Multilingual';
      } else if (fileName.includes('hindi')) {
        audioTag = 'Hindi';
      } else if (fileName.includes('english')) {
        audioTag = 'English';
      }

      const titleName = metadata.name || 'Unknown Title';
      const year = metadata.year || 'N/A';

      data.data.stream_urls.forEach((streamUrl, index) => {
        const urlLower = streamUrl.toLowerCase();
        const serverName = `Server ${index + 1}`;

        let format = 'STREAM';
        if (urlLower.includes('.mp4')) format = 'MP4';
        if (urlLower.includes('.m3u8')) format = 'HLS';

        const displayTitle = isTv
          ? `${qualityLabel} | ${audioTag} | ${format} (${serverName})\nS${season}E${episode} - ${titleName} (${year})`
          : `${qualityLabel} | ${audioTag} | ${format} (${serverName})\n${titleName} (${year})`;

        // Build Nuvio Stream Object Schema
        const streamObj = {
          name: PROVIDER_NAME,
          title: displayTitle,
          url: streamUrl,
          quality: qualityCode,
          headers: HEADERS
        };

        // Format Subtitles to Nuvio Schema
        if (data.default_subs && Array.isArray(data.default_subs) && data.default_subs.length > 0) {
          streamObj.subtitles = data.default_subs.map(sub => ({
            url: sub.url,
            language: sub.code || sub.lang || 'en',
            name: sub.lang || sub.code || 'Subtitle',
            headers: HEADERS
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

module.exports = { getStreams };

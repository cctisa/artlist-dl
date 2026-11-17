// ==UserScript==
// @name        Artlist DL
// @namespace   https://github.com/cctisa/artlist-dl
// @description Allows you to download artlist.io Music, SFX & Selected Stems (modified fork of xNasuni/artlist-downloader)
// @author      cctisa (based on Mia @ github.com/xNasuni)
// @match       *://*.artlist.io/*
// @grant       GM_xmlhttpRequest
// @connect     cms-public-artifacts.artlist.io
// @connect     cms-artifacts.artlist.io
// @require     https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @version     3.5
// @run-at      document-start
// @updateURL   https://raw.githubusercontent.com/cctisa/artlist-dl/main/artlist-dl.user.js
// @downloadURL https://raw.githubusercontent.com/cctisa/artlist-dl/main/artlist-dl.user.js
// @supportURL  https://github.com/cctisa/artlist-dl/issues
// ==/UserScript==

const LoadedMusicLists = []
const LoadedSfxLists = []
const LoadedSfxsList = []
const LoadedSongsList = []
const LoadedSstemsLists = []
const ModifiedMusicButtonColor = '#82ff59'
const ModifiedSfxButtonColor = '#ff90bf'
const ErrorButtonColor = '#ff3333'
const UNKNOWN_DATATYPE = '_unknown'
const NEXTRSC_DATATYPE = '_rsc'
const SINGLE_SOUND_EFFECT_DATATYPE = '_ssfx'
const SINGLE_SONG_DATATYPE = '_ssong'
const MUSIC_ALBUM_PAGETYPE = '_amusic'
const SONGS_PAGETYPE = '_songs'
const MUSIC_PAGETYPE = '_music'
const SFXS_PAGETYPE = '_sfxs'
const SFXP_PAGETYPE = '_sfxp'
const SFX_PAGETYPE = '_sfx'
const SONG_STEMS_PAGETYPE = '_sstem'
const oldXMLHttpRequestOpen = unsafeWindow.XMLHttpRequest.prototype.open
const oldFetch = unsafeWindow.fetch

var AudioTable
var TBody
var LastChangeObserver
var ActionContainer
var SongPage
var LastInterval = -1
var RequestsInterval = -1
var RSCInterval = -1
var DontPoll = false
var SingleSoundEffectData = 'none'
var SingleSongData = 'none'

async function ShowSaveFilePickerForURL(url, filename) {
    if (!url) {
        throw new Error('no url passed in')
    }

    let blobDataFromURL = null
    const headers = {
        Referer: 'https://artlist.io/',
        ['Sec-Fetch-Dest']: 'audio',
        ['Sec-Fetch-Mode']: 'cors',
        ['Sec-Fetch-Site']: 'same-site',
        Accept: 'audio/webm,audio/ogg,audio/wav,audio/*;q=0.9,application/ogg;q=0.7,video/*;q=0.6,*/*;q=0.5',
        ['Accept-Language']: 'en-US,en;q=0.9',
        ['Accept-Encoding']: 'identity'
    }

    if (typeof GM_xmlhttpRequest !== 'undefined') {
        blobDataFromURL = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                headers,
                responseType: 'blob',
                onload: res => {
                    if (res.response) resolve(res.response)
                    else reject(new Error('empty response'))
                },
                onerror: err => reject(err)
            })
        })
    } else {
        console.warn('using native fetch, GM_xmlhttpRequest not found')
        blobDataFromURL = await fetch(url, {
            headers
        }).then(r => r.blob())
    }

    try {
        if (unsafeWindow.showSaveFilePicker) {
            const BlobData = new Blob([blobDataFromURL], {
                type: 'audio/aac'
            })
            const Handle = await unsafeWindow.showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: 'AAC File (Compressed MP3)',
                        accept: {
                            'audio/aac': ['.aac']
                        }
                    }
                ]
            })
            const Writable = await Handle.createWritable()
            await Writable.write(BlobData)
            await Writable.close()
        } else {
            const blobURL = URL.createObjectURL(blobDataFromURL)
            const a = document.createElement('a')
            a.href = blobURL
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobURL)
        }
    } catch (e) {
        console.error('Error saving file:', e)
    }
}

async function DownloadAndShowSaveFilePickerForURLsZipped(
    files,
    filename,
    callback
) {
    let handle = null

    if (unsafeWindow.showSaveFilePicker) {
        try {
            handle = await unsafeWindow.showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: 'ZIP File',
                        accept: { 'application/zip': ['.zip'] }
                    }
                ]
            })
        } catch (e) {
            console.warn('Save picker cancelled or unavailable:', e)
            return
        }
    }

    try {
        const zip = new JSZip()
        const total = files.length

        for (let i = 0; i < total; i++) {
            const file = files[i]
            const blob = await fetch(file.URL).then(r => r.blob())
            zip.file(file.Filename, blob)

            if (typeof callback === 'function') {
                callback(i + 1, total)
            }
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' })

        if (handle) {
            const writable = await handle.createWritable()
            await writable.write(zipBlob)
            await writable.close()
        } else {
            const blobURL = URL.createObjectURL(zipBlob)
            const a = document.createElement('a')
            a.href = blobURL
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobURL)
        }
    } catch (e) {
        console.warn('Error saving zip:', e)
    }
}

function Until(testFunc) {
    // https://stackoverflow.com/a/52657929
    const poll = resolve => {
        if (DontPoll) {
            resolve()
        }
        if (testFunc()) {
            resolve()
        } else setTimeout(_ => poll(resolve), 100)
    }
    return new Promise(poll)
}

function GetPagetype() {
    const segments = unsafeWindow.location.pathname.split('/').filter(Boolean)
    const musicIndex = segments.findIndex(
        s => s === 'royalty-free-music' || s === 'music'
    )
    const sfxIndex = segments.findIndex(
        s =>
            s === 'sfx' ||
            s === 'sound-effects' ||
            s === 'royalty-free-sound-effects'
    )

    if (musicIndex !== -1) {
        const nextSegment = segments[musicIndex + 1]
        if (nextSegment === 'song' || nextSegment === 'artist') {
            return SONGS_PAGETYPE
        }
        if (nextSegment === 'album') {
            return MUSIC_ALBUM_PAGETYPE
        }
        return MUSIC_PAGETYPE
    }

    if (sfxIndex !== -1) {
        const nextSegment = segments[sfxIndex + 1]
        if (nextSegment === 'track') {
            return SFXS_PAGETYPE
        }
        if (nextSegment === 'pack') {
            return SFXP_PAGETYPE
        }
        return SFX_PAGETYPE
    }

    return UNKNOWN_DATATYPE
}

function GetDatatype(Data) {
    var Datatype = UNKNOWN_DATATYPE

    try {
        if (
            Data.data?.sfxList != undefined &&
            Data.data?.sfxList.songs != undefined
        ) {
            Datatype = SFX_PAGETYPE
        }
    } catch (e) {}
    try {
        if (
            Data.data?.songList != undefined &&
            Data.data?.songList.songs != undefined
        ) {
            Datatype = MUSIC_PAGETYPE
        }
    } catch (e) {}
    try {
        if (
            Data.data?.sfxs != undefined &&
            Data.data?.sfxs.length === 1 &&
            Data.data?.sfxs[0].similarList != undefined
        ) {
            Datatype = SFXS_PAGETYPE
        }
    } catch (e) {}
    try {
        if (Data.data?.pack != undefined && Data.data?.pack.songs != undefined) {
            Datatype = SFXP_PAGETYPE
        }
    } catch (e) {}
    try {
        if (
            Data.data?.sfxs != undefined &&
            Data.data?.sfxs.length === 1 &&
            Data.data?.sfxs[0].songName != undefined
        ) {
            Datatype = SINGLE_SOUND_EFFECT_DATATYPE
        }
    } catch (e) {}
    try {
        if (
            Data.data?.songs != undefined &&
            Data.data?.songs.length === 1 &&
            Data.data?.songs[0].songName != undefined
        ) {
            Datatype = SINGLE_SONG_DATATYPE
        }
    } catch (e) {}
    try {
        if (
            Data.data?.songs != undefined &&
            Data.data?.songs.length === 1 &&
            Data.data?.songs[0].similarSongs != undefined
        ) {
            Datatype = SONGS_PAGETYPE
        }
    } catch (e) {}

    try {
        if (
            Data.data?.songs != undefined &&
            Data.data?.songs.length >= 1 &&
            Data.data?.songs[0].stems != undefined
        ) {
            Datatype = SONG_STEMS_PAGETYPE
        }
    } catch (e) {}

    return Datatype
}

function MatchURL(Url) {
    const Pagetype = GetPagetype()
    let URLObject

    try {
        URLObject = new URL(Url)
    } catch (e) {
        return UNKNOWN_DATATYPE
    }

    const hasRsc = URLObject.searchParams.has('_rsc')
    if (hasRsc) {
        return NEXTRSC_DATATYPE
    }

    if (
        Pagetype !== UNKNOWN_DATATYPE &&
        URLObject.host === 'search-api.artlist.io' &&
        (URLObject.pathname === '/v1/graphql' ||
            URLObject.pathname === '/v2/graphql')
    ) {
        return Pagetype
    }

    return UNKNOWN_DATATYPE
}

async function GetSfxInfo(Id) {
    const Query = `query Sfxs($ids: [Int!]!) {
  sfxs(ids: $ids) {
    songId
    songName
    artistId
    artistName
    albumId
    albumName
    assetTypeId
    duration
    sitePlayableFilePath
  }
}
`
    const Variables = {
        ids: [Id]
    }

    const Payload = {
        query: Query,
        variables: Variables
    }

    const Response = await fetch('https://search-api.artlist.io/v1/graphql', {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(Payload)
    })
    const JSONData = await Response.json()

    var Data

    try {
        Data = JSONData.data.sfxs[0]
    } catch (e) {}

    if (Data === undefined) {
        return false
    }

    return Data
}

async function GetSongInfo(Id) {
    const Query = `query Songs($ids: [String!]!) {
  songs(ids: $ids) {
    songId
    songName
    artistId
    artistName
    albumId
    albumName
    assetTypeId
    duration
    sitePlayableFilePath
  }
}
`
    const Variables = {
        ids: [Id.toString()]
    }

    const Payload = {
        query: Query,
        variables: Variables
    }

    const Response = await fetch('https://search-api.artlist.io/v1/graphql', {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(Payload)
    })
    const JSONData = await Response.json()

    var Data

    try {
        Data = JSONData.data.songs[0]
    } catch (e) {}

    if (Data === undefined) {
        return false
    }

    return Data
}

async function LoadAssetInfo(Id) {
    const Pagetype = GetPagetype()
    if (Pagetype === SFXS_PAGETYPE) {
        SingleSoundEffectData = await GetSfxInfo(Id)
        return true
    }
    if (Pagetype === SONGS_PAGETYPE) {
        SingleSongData = await GetSongInfo(Id)
        return true
    }
    return false
}

function GetAudioTable() {
    return unsafeWindow.document.querySelector(
        'table.w-full.table-fixed[data-testid=AudioTable]'
    )
}

function GetSongPage() {
    return (
        unsafeWindow.document.querySelector('div[data-testid=SongPage]') ||
        unsafeWindow.document.querySelector('div#song-page-react')
    )
}

function GetBanner(SongPage) {
    return SongPage.querySelector('div')
}

function GetActionRow(SongPage) {
    if (window.innerWidth >= 1024) {
        // page layout changes depending on viewport size
        return SongPage.querySelector('div.hidden')
    }
    return SongPage.querySelector('div.block.py-4.px-6')
}

function GetTBody() {
    return (
        unsafeWindow.document.querySelector(
            'div.w-full[data-testid=ComposableAudioList]'
        ) ||
        unsafeWindow.document.querySelector(
            'div[data-testid=ComposableAudioList]'
        ) ||
        unsafeWindow.document.querySelector(
            'table[data-testid=AudioTable]>tbody'
        ) ||
        unsafeWindow.document.querySelector(
            'table.w-full.table-fixed[data-testid=AudioTable]'
        ) ||
        unsafeWindow.document.querySelector('main') ||
        unsafeWindow.document.querySelector('div[data-testid=Wrapper]') ||
        unsafeWindow.document.body
    )
}

function GetTBodyEdgeCase() {
    const TBody =
        unsafeWindow.document.querySelector('div[data-testid=Wrapper]') ||
        unsafeWindow.document.querySelector('div[data-testid=ArtistContent]') ||
        unsafeWindow.document.querySelector('div#song-page-tab-panel-1') ||
        unsafeWindow.document.querySelector(
            'div[data-testid=ComposableAudioList]'
        )
    if (TBody === null) {
        return
    }
    if (TBody.parentNode.classList.contains('hidden')) {
        return
    }
    if (
        TBody.querySelector(
            '[data-testid=music-row], [data-testid=AudioRow], [data-testid=AlbumRow], [data-testid=SongVariantsWrapper], [data-testid=SfxRow]'
        ) == null
    ) {
        return
    }

    return TBody
}

function GetAudioRowData(AudioRow, Pagetype) {
    var Data = {
        AudioTitle: 'none',
        RawTitle: 'None',
        Artists: [],
        Button: null,
        Pagetype: Pagetype,
        Row: AudioRow
    }

    if (Pagetype == SONG_STEMS_PAGETYPE) {
        const title = AudioRow.querySelector(
            'span[data-testid=stems-player-stem-name]'
        )
        const button = AudioRow.querySelector(
            'button[data-testid=DownloadButton]'
        )

        if (!title || !button) {
            return Data
        }

        Data.AudioTitle = title.innerText.trim()
        Data.RawTitle = title.innerText
        Data.Button = button
        Data.Row = AudioRow
        return Data
    }

    var AlbumsAndArtists =
        AudioRow.querySelector('div[data-testid=AudioDetails]') ||
        AudioRow.querySelector('div.flex[data-testid=AudioDetails]') ||
        AudioRow.querySelector('td[data-testid=AlbumsAndArtists]')

    var DataAndActions =
        AudioRow.querySelector('div[data-testid=AnimatedToggleContainer]') ||
        AudioRow.querySelector('td[data-testid=DataAndActions]') ||
        AudioRow

    if (!DataAndActions) {
        console.warn('DataAndActions not found in', Pagetype, AudioRow)
    }

    var Button =
        DataAndActions.querySelector("button[aria-label='download']") ||
        DataAndActions.querySelector("button[aria-label='Download']") ||
        DataAndActions.querySelector("button[data-testid=DownloadButton]") ||
        AudioRow.querySelector("button[aria-label='download']") ||
        AudioRow.querySelector("button[aria-label='Download']") ||
        AudioRow.querySelector("button[data-testid=DownloadButton]")

    if (Button) {
        Data.Button = Button
    }

    if (AlbumsAndArtists == null) {
        return Data
    }

    const AudioTitle =
        AlbumsAndArtists.querySelector('div[data-testid=audio-name] a') ||
        AlbumsAndArtists.querySelector('div[data-testid=audio-name]') ||
        AlbumsAndArtists.querySelector('a.truncate[data-testid=Link]') ||
        AlbumsAndArtists.querySelector('a[data-testid=Link]') ||
        AlbumsAndArtists.querySelector('[data-testid=Link]') ||
        AlbumsAndArtists.querySelector('.truncate')

    const Artists = AlbumsAndArtists.querySelectorAll(
        'div[data-testid=artist-name] a, a.truncate.text-gray-200[data-testid=Link], a[data-testid=Link].text-gray-200, a.truncate[data-testid=ArtistLink]'
    )

    if (AudioTitle) {
        Data.AudioTitle = (
            AudioTitle.childNodes[0]?.textContent ||
            AudioTitle.textContent ||
            ''
        ).trim()
        Data.RawTitle = Data.AudioTitle
    }
    if (Artists && Artists.length > 0) {
        for (const Artist of Artists) {
            Data.Artists.push(Artist.textContent.replaceAll(',', '').trim())
        }
    }

    const isSfx =
        Pagetype === SFX_PAGETYPE ||
        Pagetype === SFXP_PAGETYPE ||
        Pagetype === SFXS_PAGETYPE

    if (
        Data.AudioTitle === 'none' &&
        (isSfx || Data.Artists.length === 0) &&
        Data.Button == null
    ) {
        return false
    }

    return Data
}

function GetBannerData(SongPage, Pagetype) {
    const Data = {
        AudioTitle: 'none',
        RawTitle: 'none',
        Artists: [],
        Button: null,
        Pagetype: Pagetype
    }

    const Banner = GetBanner(SongPage)
    const ActionRow = GetActionRow(SongPage)

    if (Banner === null || ActionRow === null) {
        return false
    }

    const Titles = Banner.querySelectorAll('h1')
    const Artists = Banner.querySelectorAll('a[data-testid=Link]')
    const Button =
        ActionRow.querySelector("button[aria-label='direct download']") ||
        ActionRow.querySelector("button[aria-label='download']") ||
        ActionRow.querySelector("button[aria-label='Download']")

    const isSfx =
        Pagetype === SFX_PAGETYPE ||
        Pagetype === SFXP_PAGETYPE ||
        Pagetype === SFXS_PAGETYPE

    if (Titles.length < 1 || (!isSfx && Artists.length <= 0) || Button == null) {
        return Data
    }

    Data.AudioTitle = Titles[0].textContent.trim()
    Data.RawTitle = Data.AudioTitle
    Data.Button = Button

    for (const Artist of Artists) {
        Data.Artists.push(Artist.textContent.replaceAll(',', '').trim())
    }

    if (
        Data.AudioTitle === 'none' &&
        (isSfx || Data.Artists.length == 0) &&
        Data.Button == null
    ) {
        return false
    }
    if (
        (Data.AudioTitle === 'none' || (!isSfx && Data.Artists.length == 0)) &&
        Data.Button != null
    ) {
        Data.Button.style.color = ErrorButtonColor
        Data.Button.style.borderColor = ErrorButtonColor
    }

    return Data
}

function MakeFilename(AssetData, Datatype) {
    const NoAlbum = AssetData.albumId === undefined
    const isMusic =
        Datatype === MUSIC_PAGETYPE ||
        Datatype === SONGS_PAGETYPE ||
        Datatype === SONG_STEMS_PAGETYPE
    const prefix = isMusic
        ? Datatype == SONG_STEMS_PAGETYPE
            ? 'Music Stem'
            : 'Music'
        : 'Sfx'
    const artistPart = AssetData.artistName ? `${AssetData.artistName} - ` : ''
    const titlePart = AssetData.songName || AssetData.name || 'Untitled'
    const albumPart =
        AssetData.albumName && AssetData.songName != AssetData.albumName
            ? `on ${AssetData.albumName} `
            : ''
    const idPart = `(${AssetData.artistId ? AssetData.artistId + '.' : ''}${NoAlbum ? '' : AssetData.albumId + '.'}${AssetData.songId || AssetData.id || ''})`
    return `${prefix} ${artistPart}${titlePart} ${albumPart}${idPart}`
        .trim()
        .replace(/\s+/g, ' ')
}

function WriteAudio(RowData, AudioData) {
    const Pagetype = RowData.Pagetype
    const ChosenColor =
        Pagetype === MUSIC_ALBUM_PAGETYPE ||
        Pagetype === MUSIC_PAGETYPE ||
        Pagetype === SONGS_PAGETYPE ||
        Pagetype == SONG_STEMS_PAGETYPE
            ? ModifiedMusicButtonColor
            : ModifiedSfxButtonColor
    const FileName = MakeFilename(AudioData, Pagetype)
    RowData.Button.setAttribute('artlist-dl-processed', 'true')
    RowData.Button.style.color = ChosenColor
    RowData.Button.addEventListener(
        'click',
        function (event) {
            event.stopImmediatePropagation() // prevent premium popup upsell
            ShowSaveFilePickerForURL(
                AudioData.sitePlayableFilePath ||
                    AudioData.playableFileUrl ||
                    AudioData.audioUrl,
                FileName + '.aac'
            )
        },
        true
    )
}

function WriteBanner(BannerData, AudioData) {
    const Pagetype = BannerData.Pagetype
    const ChosenColor =
        Pagetype === MUSIC_PAGETYPE ||
        Pagetype === SONGS_PAGETYPE ||
        Pagetype == SONG_STEMS_PAGETYPE
            ? ModifiedMusicButtonColor
            : ModifiedSfxButtonColor
    const FileName = MakeFilename(AudioData, Pagetype)
    BannerData.Button.setAttribute('artlist-dl-processed', 'true')
    BannerData.Button.style.color = ChosenColor
    BannerData.Button.style.borderColor = ChosenColor
    BannerData.Button.addEventListener(
        'click',
        function (event) {
            event.stopImmediatePropagation() // prevent premium popup upsell
            ShowSaveFilePickerForURL(
                AudioData.sitePlayableFilePath ||
                    AudioData.playableFileUrl ||
                    AudioData.audioUrl,
                FileName + '.aac'
            )
        },
        true
    )
}

function MatchAudioToRow(AudioData, RowData, SkipArtistCheck) {
    const audioTitle = (
        AudioData.songName ||
        AudioData.name ||
        AudioData.title ||
        ''
    )
        .trim()
        .toLowerCase()
    const rowTitle = (RowData.RawTitle || RowData.AudioTitle || '')
        .trim()
        .toLowerCase()

    const titleMatches =
        audioTitle === rowTitle ||
        (audioTitle &&
            rowTitle &&
            (audioTitle.includes(rowTitle) || rowTitle.includes(audioTitle)))
    if (!titleMatches) {
        return false
    }

    if (SkipArtistCheck) {
        return true
    }

    if (!RowData.Artists || RowData.Artists.length === 0) {
        return true
    }

    return RowData.Artists.some(artist =>
        (AudioData.artistName || '')
            .toLowerCase()
            .includes(artist.toLowerCase())
    )
}

function cloneref(object) {
    return {
        ...object
    }
}

function GetAudioDataFromFiber(element) {
    if (!element) return null
    try {
        const target =
            element.getAttribute?.('data-testid') === 'music-row'
                ? element
                : (element.querySelector?.('[data-testid=music-row]') || element)
        const goodKey = unsafeWindow.Object.keys(target).find(
            v => v.startsWith('__reactFiber') || v.startsWith('__reactInternalInstance')
        )
        if (!goodKey) return null
        let curr = target[goodKey]
        while (curr) {
            if (curr.memoizedProps?.song) {
                const s = curr.memoizedProps.song
                const songData = {
                    id: String(s.id),
                    songId: String(s.id),
                    name: s.audioDetails?.audioName || s.songName || s.name || '',
                    songName: s.audioDetails?.audioName || s.songName || s.name || '',
                    artistName: s.artistName || s.audioDetails?.artists?.[0]?.name || '',
                    artistId: String(s.artistId || s.audioDetails?.artists?.[0]?.id || ''),
                    albumName: s.albumName || '',
                    albumId: String(s.albumId || ''),
                    playableFileUrl: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath,
                    sitePlayableFilePath: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath,
                    audioUrl: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath,
                    versions: s.versions || [],
                    numberOfStems: s.numberOfStems || 0
                }
                if (s.versions && s.versions.length > 0) {
                    LoadedMusicLists.push(s.versions)
                }
                return songData
            }
            if (curr.memoizedProps?.sfx) {
                const s = curr.memoizedProps.sfx
                return {
                    id: String(s.id || s.songId),
                    songId: String(s.id || s.songId),
                    name: s.songName || s.name || '',
                    songName: s.songName || s.name || '',
                    playableFileUrl: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath,
                    sitePlayableFilePath: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath,
                    audioUrl: s.audioUrl || s.playableFileUrl || s.sitePlayableFilePath
                }
            }
            curr = curr.return
        }
    } catch (e) {
        console.warn('Fiber audio extraction error:', e)
    }
    return null
}

function GetAudioDataFromRowData(RowData, OptionalStemParentData) {
    if (RowData.Row) {
        const fiberAudio = GetAudioDataFromFiber(RowData.Row)
        if (fiberAudio) {
            if (RowData.AudioTitle === 'none' && fiberAudio.songName) {
                RowData.AudioTitle = fiberAudio.songName
                RowData.RawTitle = fiberAudio.songName
            }
            if ((!RowData.Artists || RowData.Artists.length === 0) && fiberAudio.artistName) {
                RowData.Artists = [fiberAudio.artistName]
            }
            return fiberAudio
        }
    }
    if (
        RowData.Pagetype == SFX_PAGETYPE ||
        RowData.Pagetype == SFXS_PAGETYPE ||
        RowData.Pagetype == SFXP_PAGETYPE
    ) {
        if (LoadedSfxLists.length > 0) {
            for (const SfxList of LoadedSfxLists) {
                for (const SfxData of SfxList) {
                    if (MatchAudioToRow(SfxData, RowData, true)) {
                        return SfxData
                    }
                }
            }
        }
        if (LoadedSfxsList.length > 0) {
            for (const SfxsList of LoadedSfxsList) {
                for (const SfxData of SfxsList) {
                    if (MatchAudioToRow(SfxData, RowData, true)) {
                        return SfxData
                    }
                }
            }
        }
    }
    if (
        RowData.Pagetype == MUSIC_PAGETYPE ||
        RowData.Pagetype == MUSIC_ALBUM_PAGETYPE
    ) {
        if (LoadedMusicLists.length <= 0) {
            console.warn('No loaded songs to loop through.')
            return
        }
        for (const MusicList of LoadedMusicLists) {
            for (const SongData of MusicList) {
                if (MatchAudioToRow(SongData, RowData)) {
                    return SongData
                }
            }
        }
    }
    if (RowData.Pagetype == SONGS_PAGETYPE) {
        if (LoadedSongsList.length > 0) {
            for (const SongsList of LoadedSongsList) {
                for (const SongData of SongsList) {
                    if (MatchAudioToRow(SongData, RowData)) {
                        return SongData
                    }
                }
            }
        }
        if (LoadedMusicLists.length > 0) {
            for (const MusicList of LoadedMusicLists) {
                for (const SongData of MusicList) {
                    if (MatchAudioToRow(SongData, RowData)) {
                        return SongData
                    }
                }
            }
        }
    }

    if (RowData.Pagetype == SONG_STEMS_PAGETYPE) {
        if (LoadedSstemsLists.length <= 0) {
            console.warn('No loaded song stems to loop through.')
            return
        }
        for (const StemData of LoadedSstemsLists) {
            for (const Stem of StemData) {
                if (Stem.id == RowData.StemId) {
                    const clonedData = cloneref(OptionalStemParentData)
                    clonedData.sitePlayableFilePath = Stem.playableFileUrl
                    clonedData._songName = clonedData.songName
                    clonedData._albumName = clonedData.albumName
                    clonedData.songName = `${Stem.name} of ${clonedData._songName}`
                    return clonedData
                }
            }
        }
    }

    console.warn("Couldn't find loaded audio for data:", RowData)
}

function getReactInternal(element) {
    const goodKey = unsafeWindow.Object.keys(element).find(v =>
        v.startsWith('__reactFiber')
    )
    if (!goodKey) {
        return
    }
    return element[goodKey]
}

function OnRowAdded(AudioRow, RowData, AudioData) {
    if (AudioData !== undefined) {
        WriteAudio(RowData, AudioData)
    } else {
        console.warn('No data given for row', RowData)
        if (RowData.Button !== null) {
            RowData.Button.style.color = ErrorButtonColor
        }
    }
}

function OnAudioRowAdded(AudioRow) {
    if (AudioRow.hasAttribute('artlist-dl-processed')) {
        return
    }
    if (AudioRow.classList.contains('hidden')) {
        return
    }
    const RowData = GetAudioRowData(AudioRow, GetPagetype())
    if (!RowData || !RowData.Button) {
        return
    }
    if (RowData.Button.hasAttribute('artlist-dl-processed')) {
        AudioRow.setAttribute('artlist-dl-processed', 'true')
        return
    }
    RowData.Row = AudioRow
    const AudioData = GetAudioDataFromRowData(RowData)

    OnRowAdded(AudioRow, RowData, AudioData)
}

function WriteStem(StemData, StemAudioData) {
    const ChosenColor = ModifiedMusicButtonColor
    const FileName = MakeFilename(StemAudioData, SONG_STEMS_PAGETYPE)
    StemData.Button.setAttribute('artlist-dl-processed', 'true')
    StemData.Button.style.color = ChosenColor
    StemData.Button.addEventListener(
        'click',
        function (event) {
            event.stopImmediatePropagation() // prevent premium popup upsell
            ShowSaveFilePickerForURL(
                StemAudioData.sitePlayableFilePath ||
                    StemAudioData.playableFileUrl,
                FileName + '.aac'
            )
        },
        true
    )
}

function OnStemRowAdded(StemRow, StemId, HeaderData) {
    if (StemRow.hasAttribute('artlist-dl-processed')) {
        return
    }
    if (StemRow.classList.contains('hidden')) {
        return
    }
    const StemData = GetAudioRowData(StemRow, SONG_STEMS_PAGETYPE)
    if (StemData.AudioTitle == '' || StemData.Button == null) {
        return
    }

    StemData.StemId = StemId

    const AudioData = GetAudioDataFromRowData(HeaderData)
    const StemAudioData = GetAudioDataFromRowData(StemData, AudioData)

    StemRow.__artlist_dl_data = { StemData, StemAudioData }
    WriteStem(StemData, StemAudioData)
}

function WriteDownloadAllStems(stemsList, DownloadButton) {
    const SetText = function (text) {
        const span = DownloadButton.querySelector('span.whitespace-nowrap')
        if (span) {
            span.innerText = text
        } else {
            DownloadButton.innerText = text
        }
    }

    const ChosenColor = ModifiedMusicButtonColor
    DownloadButton.setAttribute('artlist-dl-processed', 'true')
    DownloadButton.style.backgroundColor = ChosenColor
    DownloadButton.style.borderColor = ChosenColor
    DownloadButton.style.color = 'black'

    function updateButtonState() {
        const selected = stemsList.filter(s => !s.checkbox || s.checkbox.checked)
        const total = stemsList.length
        if (selected.length === total) {
            SetText(`Download All Stems (${total})`)
            DownloadButton.disabled = false
            DownloadButton.style.opacity = '1'
            DownloadButton.style.cursor = 'pointer'
        } else if (selected.length > 0) {
            SetText(`Download Selected (${selected.length}/${total})`)
            DownloadButton.disabled = false
            DownloadButton.style.opacity = '1'
            DownloadButton.style.cursor = 'pointer'
        } else {
            SetText(`Select Stems (0/${total})`)
            DownloadButton.disabled = true
            DownloadButton.style.opacity = '0.5'
            DownloadButton.style.cursor = 'not-allowed'
        }
    }

    stemsList.forEach(s => {
        if (s.checkbox) {
            s.checkbox.onchange = updateButtonState
        }
    })
    updateButtonState()

    let toggleContainer = DownloadButton.parentNode.querySelector(
        '.artlist-dl-stem-toggles'
    )
    if (!toggleContainer) {
        toggleContainer = document.createElement('div')
        toggleContainer.className =
            'artlist-dl-stem-toggles flex items-center justify-end gap-2 text-xs text-gray-200 mt-2 px-1'
        toggleContainer.innerHTML = `
            <span style="cursor: pointer; text-decoration: underline; color: #82ff59; font-weight: 500;" id="artlist-dl-select-all">All</span>
            <span style="color: #666;">/</span>
            <span style="cursor: pointer; text-decoration: underline; color: #bbb;" id="artlist-dl-select-none">None</span>
        `
        DownloadButton.parentNode.appendChild(toggleContainer)

        toggleContainer.querySelector('#artlist-dl-select-all').onclick = (e) => {
            e.stopPropagation()
            stemsList.forEach(s => {
                if (s.checkbox) s.checkbox.checked = true
            })
            updateButtonState()
        }

        toggleContainer.querySelector('#artlist-dl-select-none').onclick = (e) => {
            e.stopPropagation()
            stemsList.forEach(s => {
                if (s.checkbox) s.checkbox.checked = false
            })
            updateButtonState()
        }
    }

    DownloadButton.addEventListener(
        'click',
        async function (event) {
            event.stopImmediatePropagation() // prevent dropdown
            const selectedStems = stemsList.filter(
                s => !s.checkbox || s.checkbox.checked
            )
            if (selectedStems.length === 0) {
                return
            }

            const dataList = []
            var firstData = null

            DownloadButton.disabled = true
            SetText('Downloading...')

            try {
                for (const stem of selectedStems) {
                    if (!firstData) {
                        firstData = stem.StemAudioData
                    }

                    dataList.push({
                        URL:
                            stem.StemAudioData.sitePlayableFilePath ||
                            stem.StemAudioData.playableFileUrl,
                        Filename:
                            MakeFilename(
                                stem.StemAudioData,
                                SONG_STEMS_PAGETYPE
                            ) + '.aac'
                    })
                }

                const isAll = selectedStems.length === stemsList.length
                const countLabel = isAll
                    ? ''
                    : ` (${selectedStems.length} of ${stemsList.length} Stems)`
                const albumPart =
                    firstData._albumName &&
                    firstData._songName !== firstData._albumName
                        ? ` on ${firstData._albumName}`
                        : ''
                const fileName = `Music Stems${countLabel} ${firstData.artistName} - ${firstData._songName}${albumPart}.zip`

                await DownloadAndShowSaveFilePickerForURLsZipped(
                    dataList,
                    fileName,
                    function (idx, max) {
                        SetText(`Downloading (${idx}/${max})...`)
                    }
                )

                DownloadButton.disabled = false
                updateButtonState()
            } catch (e) {
                DownloadButton.disabled = true
                DownloadButton.style.backgroundColor = ErrorButtonColor
                DownloadButton.style.borderColor = ErrorButtonColor
                SetText('Make issue, report error in console')
                console.error(e)
                alert(
                    `Artlist Downloader: please report this in https://github.com/cctisa/artlist-dl/issues\n#EWDAS>${String(e)}`
                )
                throw e
            }
        },
        true
    )
}

function WriteMusicModal(ModalContainer) {
    for (const Stem of ModalContainer.querySelectorAll(
        'div[data-testid=song-version-row],div[data-testid=versions-and-stems-modal-header]'
    )) {
        if (
            !Stem.hasAttribute('artlist-dl-processed') &&
            document.contains(Stem)
        ) {
            try {
                OnAudioRowAdded(Stem)
                Stem.setAttribute('artlist-dl-processed', 'true')
            } catch (e) {} // will fail on false positives so just hide errors
        }
    }

    const Player = ModalContainer.querySelector('div[data-testid=Player]')
        ?.children[0]
    if (Player) {
        const Header = ModalContainer.querySelector(
            '[data-testid=versions-and-stems-modal-header]'
        )
        const HeaderData =
            (Header && GetAudioDataFromFiber(Header)) ||
            (Header ? GetAudioRowData(Header, GetPagetype()) : null)
        const AudioData = HeaderData
            ? GetAudioDataFromFiber(Header) || GetAudioDataFromRowData(HeaderData)
            : null

        const internal = getReactInternal(Player)
        if (!internal?.memoizedProps?.children) {
            return
        }
        const stemsList = []
        for (
            var index = 0;
            index < internal.memoizedProps.children.length;
            index++
        ) {
            const StemRow = Player.children[index]
            if (!StemRow) {
                continue
            }
            const childFiber = internal.memoizedProps?.children?.[index]
            const StemId =
                childFiber?.key || internal.memoizedProps.children[index].key
            if (typeof StemId != 'string') {
                return
            }

            const stemProp = childFiber?.props?.stem

            const nameEl = StemRow.querySelector(
                '[data-testid=stems-player-stem-name]'
            )
            let checkbox = StemRow.querySelector('.artlist-dl-stem-checkbox')
            if (!checkbox && nameEl) {
                checkbox = document.createElement('input')
                checkbox.type = 'checkbox'
                checkbox.className = 'artlist-dl-stem-checkbox'
                checkbox.style.cssText =
                    'width: 16px; height: 16px; margin-right: 10px; cursor: pointer; accent-color: #82ff59; vertical-align: middle; flex-shrink: 0;'
                checkbox.checked = true
                checkbox.onclick = (e) => e.stopPropagation()
                nameEl.parentNode.insertBefore(checkbox, nameEl)
            }

            OnStemRowAdded(StemRow, StemId, HeaderData)
            StemRow.setAttribute('artlist-dl-processed', 'true')

            let StemDlData = StemRow.__artlist_dl_data
            let StemAudioData = StemDlData?.StemAudioData

            // Fiber fallback если в LoadedSstemsLists пусто
            if (!StemAudioData && stemProp) {
                const parentName =
                    AudioData?.songName || AudioData?.name || 'Song'
                StemAudioData = {
                    ...(AudioData || {}),
                    id: stemProp.id,
                    stemId: stemProp.id,
                    stemName: stemProp.name,
                    playableFileUrl: stemProp.playableFileUrl,
                    sitePlayableFilePath: stemProp.playableFileUrl,
                    _songName: parentName,
                    _albumName: AudioData?.albumName || '',
                    artistName: AudioData?.artistName || '',
                    songName: `${stemProp.name} of ${parentName}`
                }
                const StemData = GetAudioRowData(StemRow, SONG_STEMS_PAGETYPE)
                StemDlData = { StemData, StemAudioData }
                StemRow.__artlist_dl_data = StemDlData
                if (StemData.Button) {
                    WriteStem(StemData, StemAudioData)
                }
            }

            if (!StemAudioData && !StemDlData?.StemAudioData) {
                return
            }

            stemsList.push({
                StemAudioData: StemAudioData || StemDlData.StemAudioData,
                StemData: StemDlData?.StemData,
                StemRow,
                StemId,
                checkbox,
                index
            })
        }

        for (const DownloadButton of ModalContainer.querySelectorAll(
            'button[data-testid=renderButton]'
        )) {
            if (
                !DownloadButton.hasAttribute('artlist-dl-processed') &&
                DownloadButton.parentNode.getAttribute('data-testid') ==
                    'download-all-stems-dropdown'
            ) {
                WriteDownloadAllStems(stemsList, DownloadButton)
            }
        }
    }
}

function transformIndexedObject2Array(object) {
    return Object.values(object)
}

function HandleJSONData(Data) {
    if (!Data || typeof Data !== 'object') return

    const Datatype = GetDatatype(Data)
    if (Datatype === SONGS_PAGETYPE) {
        if (Data.data?.songs?.[0]?.similarSongs) {
            LoadedSongsList.push(Data.data.songs[0].similarSongs)
        }
        return
    }
    if (Datatype === MUSIC_PAGETYPE) {
        const songs = Data.data?.songList?.songs || []
        LoadedMusicLists.push(songs)
        for (const Song of songs) {
            if (Song.versions != null) {
                LoadedMusicLists.push(Song.versions)
            }
        }
        return
    }
    if (Datatype === SFXS_PAGETYPE) {
        if (Data.data?.sfxs?.[0]?.similarList) {
            LoadedSfxsList.push(Data.data.sfxs[0].similarList)
        }
        return
    }
    if (Datatype == SFXP_PAGETYPE) {
        if (Data.data?.pack?.songs) {
            LoadedSfxsList.push(Data.data.pack.songs)
        }
        return
    }
    if (Datatype === SFX_PAGETYPE) {
        if (Data.data?.sfxList?.songs) {
            LoadedSfxLists.push(Data.data.sfxList.songs)
        }
        return
    }
    if (Datatype == SONG_STEMS_PAGETYPE) {
        const songs = Data.data?.songs || []
        for (const Song of songs) {
            if (Song.stems != null) {
                LoadedSstemsLists.push(Song.stems)
            }
        }
        return
    }

    // Direct fallbacks if structure doesn't match predefined Pagetype
    if (Data.sfxList?.songs) {
        LoadedSfxLists.push(Data.sfxList.songs)
        return
    }
    if (Data.data?.sfxList?.songs) {
        LoadedSfxLists.push(Data.data.sfxList.songs)
        return
    }
    if (Data.data?.sfxs) {
        LoadedSfxsList.push(Data.data.sfxs)
        return
    }

    console.warn('Not processed:', Datatype, Data)
}

function HandleRSCEntry(DataStr) {
    var Data = null

    try {
        const [_, right] = DataStr.split(/:(.+)/)
        Data = JSON.parse(right || DataStr)
    } catch (e) {
        try {
            Data = JSON.parse(DataStr)
        } catch (err) {
            return
        }
    }

    var found = null

    for (const k in Data) {
        const v = Data[k]

        if (
            v &&
            typeof v === 'object' &&
            ('artistSongs' in v ||
                'songData' in v ||
                'pack' in v ||
                'album' in v ||
                'sfxList' in v ||
                'sfxs' in v ||
                'songList' in v ||
                v?.data?.sfxs ||
                v?.data?.sfxList ||
                v?.data?.songList)
        ) {
            found = v
        }
    }

    if (!found) {
        if (
            Data &&
            typeof Data === 'object' &&
            ('artistSongs' in Data ||
                'songData' in Data ||
                'pack' in Data ||
                'album' in Data ||
                'sfxList' in Data ||
                'sfxs' in Data ||
                'songList' in Data ||
                Data?.data?.sfxs ||
                Data?.data?.sfxList ||
                Data?.data?.songList)
        ) {
            found = Data
        }
    }

    if (!found) {
        return
    }

    try {
        const datatype = GetDatatype(found)
        if (datatype != UNKNOWN_DATATYPE) {
            HandleJSONData(found)
            return
        }

        if (!!found.album) {
            HandleJSONData({
                data: {
                    songList: {
                        songs: found.album.songs
                    }
                }
            })
        }

        if (!!found.pack) {
            HandleJSONData({
                data: {
                    pack: found.pack
                }
            })
        }

        if (!!found.sfxList) {
            HandleJSONData({
                data: {
                    sfxList: found.sfxList
                }
            })
        }

        if (!!found.songList) {
            HandleJSONData({
                data: {
                    songList: found.songList
                }
            })
        }

        if (!!found.songData) {
            HandleJSONData({
                data: {
                    sfxs: [
                        {
                            similarList: [found.songData]
                        }
                    ]
                }
            })
        }

        if (!!found.artistSongs) {
            for (var song of found.artistSongs) {
                if (song.audioDetails) {
                    song.songId = song.audioDetails.audioId
                    song.songName = song.audioDetails.audioName
                    song.artistName = song.audioDetails.artists?.[0]?.name || ''
                    song.artistId = song.audioDetails.artists?.[0]?.id || ''
                    song.sitePlayableFilePath = song.audioUrl
                }
            }
            HandleJSONData({
                data: {
                    sfxList: {
                        page: 1,
                        songs: transformIndexedObject2Array(found.artistSongs),
                        suggestion: []
                    }
                }
            })
        }
    } catch (e) {
        console.warn(found)
        console.error(e)
    }
}

function HookNextRSC() {
    var oldNextFPush = null
    var handler = function () {
        try {
            const Container = arguments[0]
            if (Container[0] != 1) {
                throw new Error('invalid format')
            }

            const DataStr = Container[1]
            HandleRSCEntry(DataStr)
        } catch (e) {}

        return oldNextFPush.apply(this, arguments)
    }

    if (RSCInterval != -1) {
        clearInterval(RSCInterval)
    }
    RSCInterval = setInterval(() => {
        if (!unsafeWindow.__next_f || !unsafeWindow.__next_f.push) {
            return
        }
        if (unsafeWindow.__next_f.push == handler) {
            return
        }

        oldNextFPush = unsafeWindow.__next_f.push
        unsafeWindow.__next_f.push = handler
    })
}

function HandleListRSC(responseText) {
    const Entries = responseText.split('\n').filter(v => !v.trim() == '')

    for (var Entry of Entries) {
        try {
            HandleRSCEntry(Entry)
        } catch (e) {}
    }
}

function ApplyXHR(XHR, Datatype) {
    if (Datatype !== UNKNOWN_DATATYPE) {
        XHR.addEventListener('readystatechange', function () {
            if (XHR.readyState == XMLHttpRequest.DONE) {
                if (Datatype == NEXTRSC_DATATYPE) {
                    HandleListRSC(XHR.responseText)
                } else {
                    var JSONData
                    try {
                        JSONData = JSON.parse(XHR.responseText)
                    } catch (e) {
                        console.warn(
                            `Couldn't parse as json: ${XHR.responseText}`
                        )
                        return
                    }
                    HandleJSONData(JSONData)
                }
            }
        })
    }
}

function HookRequests() {
    var handler = function () {
        const Method = arguments[0]
        const URL = arguments[1]

        const UrlDatatype = MatchURL(URL)
        if (UrlDatatype != UNKNOWN_DATATYPE) {
            ApplyXHR(this, UrlDatatype)
        }

        return oldXMLHttpRequestOpen.apply(this, arguments)
    }
    var handler_fetch = async function () {
        const URL = arguments[0]

        const data = await oldFetch.apply(this, arguments)

        const UrlDatatype = MatchURL(URL)
        if (UrlDatatype != UNKNOWN_DATATYPE) {
            try {
                const text = await data.clone().text()
                if (UrlDatatype === NEXTRSC_DATATYPE) {
                    HandleListRSC(text)
                } else {
                    try {
                        const json = JSON.parse(text)
                        HandleJSONData(json)
                    } catch (e) {
                        HandleListRSC(text)
                    }
                }
            } catch (e) {}
        }

        return data
    }

    if (RequestsInterval != -1) {
        clearInterval(RequestsInterval)
    }
    RequestsInterval = setInterval(() => {
        unsafeWindow.XMLHttpRequest.prototype.open = handler
        unsafeWindow.fetch = handler_fetch
    })
}

// this makes the user-script support the [←] Back and [→] Right navigations
// aswell as switching pages because artlist doesn't navigate, but instead
// changes their HTML dynamically so that the end-user does not have to
// reload the entire page.

async function Initialize() {
    DontPoll = false

    const Pagetype = GetPagetype()

    if (Pagetype === SONGS_PAGETYPE || Pagetype === SFXS_PAGETYPE) {
        console.log('searching for banner...')

        SongPage = GetSongPage()
        await Until(() => {
            const Data = GetBannerData(SongPage, Pagetype)
            return Data != false && Data.Button != null
        })
        const RowData = GetBannerData(SongPage, Pagetype)
        await Until(() => {
            return GetAudioDataFromRowData(RowData) != null
        })
        const AudioData = GetAudioDataFromRowData(RowData)
        const isSfx = Pagetype === SFXS_PAGETYPE
        if (RowData.AudioTitle && (isSfx || RowData.Artists.length >= 1)) {
            WriteBanner(RowData, AudioData)
        }
    }

    console.log('searching for table...')
    if (Pagetype === SONGS_PAGETYPE || Pagetype == MUSIC_ALBUM_PAGETYPE) {
        await Until(() => {
            return GetTBodyEdgeCase() != undefined
        })
        TBody = GetTBodyEdgeCase()
    } else {
        await Until(() => {
            return GetTBody() != undefined && document.contains(GetTBody())
        })
        TBody = GetTBody()
        console.log('tbody', TBody)
    }

    console.log('found')
    LastInterval = setInterval(() => {
        if (!TBody) {
            return
        }

        for (const AudioRow of TBody.querySelectorAll(
            '[data-testid=music-row], [data-testid=AudioRow], [data-testid=AlbumRow], [data-testid=SongVariantsWrapper], [data-testid=SfxRow]'
        )) {
            if (!AudioRow.hasAttribute('artlist-dl-processed')) {
                try {
                    OnAudioRowAdded(AudioRow)
                    AudioRow.setAttribute('artlist-dl-processed', 'true')
                } catch (e) {}
            }
        }

        for (const modal of document.querySelectorAll('.ReactModal__Content')) {
            WriteMusicModal(modal)
        }
    }, 500)
}

HookNextRSC()
HookRequests()

function Start() {
    Initialize()
    setInterval(() => {
        if (TBody != null && !document.contains(TBody)) {
            console.log('Re-updating...')
            DontPoll = true
            TBody = null
            AudioTable = null
            SongPage = null
            Initialize()
        }
    }, 1000)
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Start)
} else {
    Start()
}

import React from 'react';
import './VodSyncApp.css';
import { VideoInfo, PlayerState } from '../../types';
import { Timeline } from '../Timeline/Timeline';
import { Viewer } from '../Viewer/Viewer';

// Instructions here: https://dev.twitch.tv/docs/authentication/register-app/
// Has these redirect URLs:
// - https://twitch-vod-sync.github.io (for production)
// - http://localhost:3000 (for local development)
const TWITCH_CLIENT_ID = 'm0bgzop0z8m62bacx50hxh6v0rkiwe';

// Assumed aspect ratio
const ASPECT_RATIO = 16.0 / 9.0;

const MAX_VIEWERS = 6;

interface VodSyncAppProps {}

interface VodSyncAppState {
  accessToken: string | null;
  viewers: number;
  playerState: PlayerState;
  currentPosition?: Date;
  videos: Map<number, VideoInfo>;
  width: number;
}

export class VodSyncApp extends React.PureComponent<
  VodSyncAppProps,
  VodSyncAppState
> {
  interval?: number;
  containerRef: React.RefObject<HTMLDivElement>;

  constructor(props: VodSyncAppProps) {
    super(props);
    this.state = this.initialState();
    this.containerRef = React.createRef();
    this.getTimelineBounds = this.getTimelineBounds.bind(this);
    this.setVideoInfo = this.setVideoInfo.bind(this);
    this.handlePlayerStateChange = this.handlePlayerStateChange.bind(this);
    this.handleSeek = this.handleSeek.bind(this);
    this.changeViewers = this.changeViewers.bind(this);
    this.changePlaying = this.changePlaying.bind(this);
    this.resized = this.resized.bind(this);
    window.addEventListener('resize', this.resized);
  }

  initialState(): VodSyncAppState {
    const match = window.location.hash.match(/#access_token=([^&]+)/);
    let accessToken = null;
    if (match && match[1]) {
      accessToken = match[1];
      console.log('Got access token: ', accessToken);
    }
    return {
      accessToken,
      viewers: 2,
      playerState: {
        state: 'paused',
        position: new Date(1),
      },
      videos: new Map(),
      width: window.innerWidth / 2 - 14,
    };
  }

  componentDidMount() {
    this.resized();
    this.interval = window.setInterval(
      this.computeCurrentPosition.bind(this),
      1000
    );
  }

  componentWillUnmount() {
    if (this.interval !== undefined) {
      window.clearInterval(this.interval);
      this.interval = undefined;
    }
    window.removeEventListener('resize', this.resized);
  }

  resized() {
    this.setState(state => {
      // Measure the space we have to fill
      let totalW = window.innerWidth;
      let totalH = window.innerHeight - 20;
      if (this.containerRef.current) {
        const size = this.containerRef.current.getBoundingClientRect();
        totalW = size.width;
        totalH = size.height;
      }
      // Find the number of rows to use
      // We pick the one with the best diagonal for videos
      let bestSquareDiag = 0.0;
      let bestRows = 1;
      for (let rows = 1; rows <= state.viewers; ++rows) {
        const cols = Math.ceil(state.viewers / rows);
        // Size of the area for each viewer, if we get this number of rows
        const wt = totalW / cols - 14;
        const ht = totalH / rows - 6 - 33;
        // Size of this area with the right aspect ratio
        const w = Math.min(wt, ht * ASPECT_RATIO);
        const h = Math.min(ht, wt / ASPECT_RATIO);
        // Compute the diagonal and update the best value
        const squareDiag = w * w + h * h;
        if (squareDiag > bestSquareDiag) {
          bestSquareDiag = squareDiag;
          bestRows = rows;
        }
      }
      const columns = Math.ceil(state.viewers / bestRows);
      return {
        width: totalW / columns - 14,
      };
    });
  }

  getTimelineBounds(): [Date, Date] {
    let timelineStart = new Date(8640000000000000);
    let timelineEnd = new Date(-8640000000000000);

    for (const videoInfo of Array.from(this.state.videos.values())) {
      const videoStart = videoInfo.startDate;
      const videoEnd = new Date(
        videoStart.getTime() + videoInfo.duration * 1000
      );

      if (videoStart < timelineStart) timelineStart = videoStart;
      if (videoEnd > timelineEnd) timelineEnd = videoEnd;
    }

    return [timelineStart, timelineEnd];
  }

  setVideoInfo(id: number, info: VideoInfo | undefined) {
    console.log('setVideoInfo: ', id, ', ', info);
    this.setState(state => {
      const videos = new Map(state.videos);
      if (info) {
        videos.set(id, info);
      } else {
        videos.delete(id);
      }

      // Update the player state to fall within at least one video
      let playerState = state.playerState;
      if (videos.size > 0) {
        const videosArray = Array.from(videos.values());
        const start = Math.min(...videosArray.map(v => v.startDate.getTime()));
        const end = Math.max(
          ...videosArray.map(v => v.startDate.getTime() + v.duration * 1000)
        );
        if (this.state.playerState.state === 'paused') {
          if (this.state.playerState.position.getTime() < start) {
            playerState = {
              state: 'paused',
              position: new Date(start),
            };
          } else if (this.state.playerState.position.getTime() > end) {
            playerState = {
              state: 'paused',
              position: new Date(end),
            };
          }
        } else if (this.state.playerState.state === 'playing') {
          const minOffset = (start - new Date().getTime()) / 1000.0;
          const maxOffset = (end - new Date().getTime()) / 1000.0;
          if (this.state.playerState.offset < minOffset) {
            playerState = {
              state: 'playing',
              offset: minOffset,
            };
          } else if (this.state.playerState.offset > maxOffset) {
            playerState = {
              state: 'playing',
              offset: maxOffset,
            };
          }
        }
      }
      return { videos, playerState };
    });
  }

  handlePlayerStateChange(id: number, playerState: PlayerState) {
    // TODO: Handle unexpected state change in players
  }

  computeCurrentPosition() {
    this.setState(state => {
      let currentPosition;
      if (
        state.playerState?.state === 'paused' ||
        state.playerState?.state === 'buffering'
      ) {
        currentPosition = state.playerState.position;
      } else if (state.playerState?.state === 'playing') {
        currentPosition = new Date(
          new Date().getTime() + state.playerState.offset * 1000.0
        );
      } else {
        return {};
      }
      return { currentPosition };
    });
  }

  handleSeek(position: Date) {
    // Go to buffering state
    this.setState({
      playerState: {
        state: 'buffering',
        position,
        videosBuffering: new Set(this.state.videos.keys()),
      },
    });
  }

  handlePlayerReady(id: number) {
    const playerState = this.state.playerState;
    if (playerState.state === 'buffering') {
      const { position, videosBuffering } = playerState;
      videosBuffering.delete(id);
      if (videosBuffering.size === 0) {
        const offset = (position.getTime() - new Date().getTime()) / 1000.0;
        this.setState({
          playerState: {
            state: 'playing',
            offset,
          },
        });
      }
    }
  }

  changeViewers(change: 1 | -1) {
    this.setState(state => {
      const viewers = Math.max(
        1,
        Math.min(MAX_VIEWERS, state.viewers + change)
      );
      const videos = new Map();
      state.videos.forEach((info, id) => {
        if (id < viewers) {
          videos.set(id, info);
        }
      });
      return {
        viewers,
        videos,
      };
    });
    this.resized();
  }

  changePlaying(playing: boolean) {
    if (playing && this.state.playerState.state === 'paused') {
      this.setState({
        playerState: {
          state: 'playing',
          offset:
            (this.state.playerState.position.getTime() - new Date().getTime()) /
            1000.0,
        },
      });
    } else if (!playing && this.state.playerState.state === 'playing') {
      this.setState({
        playerState: {
          state: 'paused',
          position: new Date(
            new Date().getTime() + this.state.playerState.offset * 1000.0
          ),
        },
      });
    }
  }

  doTwitchRedirect() {
    // Note that this encodes the current URL so that we can return to where we came from (e.g. dev vs production)
    const twitchAuth =
      'https://id.twitch.tv/oauth2/authorize?client_id=' +
      TWITCH_CLIENT_ID +
      '&redirect_uri=' +
      encodeURIComponent(window.location.origin) +
      '&response_type=token&scope=';

    const autoRedirect = document.getElementById(
      'autoRedirect'
    ) as HTMLInputElement;

    // May be null if the checkbox didn't render; i.e. we are already auto-redirecting
    if (autoRedirect !== null && autoRedirect.checked) {
      window.localStorage.setItem('autoRedirect', 'true');
    }

    window.location.href = twitchAuth;
  }

  render() {
    if (!this.state.accessToken) {
      if (window.localStorage.getItem('autoRedirect') === 'true') {
        this.doTwitchRedirect();
      }

      return (
        <div
          style={{
            width: '50%',
            textAlign: 'center',
            margin: 'auto',
          }}
        >
          This website lets you watch multiple Twitch VODs at the same time, so
          that you can watch a race (or similar) after the fact.
          <br />
          However, to do so it needs to call the Twitch APIs to get VOD details.
          <br />
          None of the APIs it calls are private, however it still needs a token
          to call them.
          <br />
          This token is not persisted; it is only kept in this browser's URL.
          <br />
          Please click below to authorize this application, or close this page
          and find an alternative.
          <br />
          <br />
          <input type="checkbox" id="autoRedirect" />
          <label htmlFor="autoRedirect" style={{ userSelect: 'none' }}>
            In the future, automatically redirect me to Twitch
          </label>
          <br />
          <br />
          <input
            type="button"
            value="Click here"
            style={{
              fontSize: '2em',
            }}
            onClick={this.doTwitchRedirect}
          />
        </div>
      );
    }

    const viewers = [];
    for (let i = 0; i < this.state.viewers; ++i) {
      viewers.push(
        <Viewer
          id={i}
          key={i}
          clientId={TWITCH_CLIENT_ID}
          accessToken={this.state.accessToken}
          state={this.state.playerState}
          getTimelineBounds={this.getTimelineBounds}
          setVideoInfo={this.setVideoInfo}
          setPlayerReady={() => this.handlePlayerReady(i)}
          onChange={this.handlePlayerStateChange}
          width={this.state.width}
        />
      );
    }

    return (
      <div className="view-container" ref={this.containerRef}>
        <div className="videos">{viewers}</div>
        <div className="timeline">
          <Timeline
            currentPosition={this.state.currentPosition}
            playing={this.state.playerState.state !== 'paused'}
            videos={this.state.videos}
            onSeek={this.handleSeek}
            onViewersChange={this.changeViewers}
            onPlayingStateChange={this.changePlaying}
          />
        </div>
      </div>
    );
  }
}

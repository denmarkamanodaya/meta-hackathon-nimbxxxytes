// A project's key art (board V16): the banner with "Key art · drawn by Muse Image from 4 moments",
// New art and its price, Download, the drawing state, and under it the moments it was drawn from.
import { Link } from 'react-router';
import { COVER_STYLE_COPY, MUSE_IMAGE_COPY, projectArtLabel } from '../../core/copy';
import { formatDuration } from '../../core/format';
import { MUSE_COST } from '../../core/muse-image';
import { Icon } from '../../design/Icon';
import { useProjectArt } from '../../hooks/useProjects';
import type { Project } from '../../services/api/types';
import { DrawingVeil } from '../DrawingVeil';
import './ProjectKeyArt.css';

/**
 * The banner and the Drawn from list.
 * @param props - The project.
 * @returns The key art block.
 */
export function ProjectKeyArt({ project }: { project: Project }) {
  const { newArt } = useProjectArt(project);
  const art = project.art_url;
  return (
    <div className="project-art">
      <section className="project-art__banner" aria-label={COVER_STYLE_COPY.key_art}>
        {art !== null && <img className="project-art__img" src={art} alt="" />}
        {project.art_drawing && <DrawingVeil label={MUSE_IMAGE_COPY.drawingProjectArt} />}
        <div className="project-art__bar">
          {art !== null && (
            <span className="project-art__label">
              {project.art_sources.length > 0 ? projectArtLabel(project.art_sources.length) : COVER_STYLE_COPY.key_art}
            </span>
          )}
          <span className="mac-columns__grow" />
          <button
            type="button"
            className="project-art__button"
            disabled={project.art_drawing || project.clip_count === 0}
            onClick={() => {
              void newArt();
            }}
          >
            <Icon name="refresh" size="xs" />
            {MUSE_COST.newArt}
          </button>
          {art === null ? (
            <button type="button" className="project-art__button" disabled>
              {MUSE_IMAGE_COPY.download}
            </button>
          ) : (
            <a className="project-art__button" href={art} download={`${project.name} key art.jpg`}>
              {MUSE_IMAGE_COPY.download}
            </a>
          )}
        </div>
      </section>
      {project.art_sources.length > 0 && (
        <div className="project-art__sources">
          <span className="mac-columns__label">{MUSE_IMAGE_COPY.drawnFrom}</span>
          <ul className="project-art__list">
            {project.art_sources.map((source) => (
              <li key={`${source.clip_id}@${String(source.start_s)}`}>
                <Link className="project-art__source" to={`/clips/${encodeURIComponent(source.clip_id)}?t=${String(Math.floor(source.start_s))}`}>
                  <span className="project-art__thumb">{source.thumb_url !== null && <img src={source.thumb_url} alt="" />}</span>
                  <span className="project-art__source-text">
                    <span className="project-art__source-title">{source.title}</span>
                    <span className="project-art__at">{`${source.clip_title} · ${formatDuration(source.start_s)}`}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

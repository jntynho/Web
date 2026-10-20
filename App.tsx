
import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './AppContext';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { AddEditLink } from './pages/AddEditLink';
import { AddGalleryLinks } from './pages/AddGalleryLinks';
import { Settings } from './pages/Settings';
import { Photoset } from './pages/Photoset';
import { PhotosetPreview } from './pages/PhotosetPreview';
import { ActorManagement } from './pages/ActorManagement';
import { AddEditActor } from './pages/AddEditActor';
import { StudioManagement } from './pages/StudioManagement';
import { AddEditStudio } from './pages/AddEditStudio';
import { CoomerManagement } from './pages/CoomerManagement';
import { AddEditCoomer } from './pages/AddEditCoomer';
import { CoomerDetail } from './pages/CoomerDetail';
import { AddCoomerSocials } from './pages/AddCoomerSocials';
import { CoomerImageViewer } from './pages/CoomerImageViewer';
import { ActorLinks } from './pages/ActorLinks';
import { StudioLinks } from './pages/StudioLinks';
import { PreviewImage } from './pages/PreviewImage';
import { HanimeManagement } from './pages/HanimeManagement';
import { AddEditHanime } from './pages/AddEditHanime';
import { EditEpisode } from './pages/EditEpisode';
import { HanimeDetail } from './pages/HanimeDetail';
import { SecondCovers } from './pages/SecondCovers';
import { AddEpisodes } from './pages/AddEpisodes';
import { StashDb } from './pages/StashDb';
import { supabase } from './supabase';

const App: React.FC = () => {
  useEffect(() => {
    if (window.opener) {
      // Check for auth state changes which Supabase handles from the URL hash
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || session) {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', hash: window.location.hash }, '*');
          window.close();
        }
      });
      // Also fallback timeout if the hash exists but event doesn't fire
      if (window.location.hash.includes('access_token')) {
        setTimeout(() => {
          window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', hash: window.location.hash }, '*');
          window.close();
        }, 1500);
      }
      return () => subscription.unsubscribe();
    }
  }, []);

  return (
    <AppProvider>
      <Router>
        <Routes>
          <Route path="/preview/:id" element={<PreviewImage />} />
          <Route path="/photoset/:id" element={<Photoset />} />
          <Route path="/photoset/:id/preview/:index" element={<PhotosetPreview />} />
          <Route path="/coomer/:id/media/:index" element={<CoomerImageViewer />} />
          <Route path="/coomer/:id/media/:tab/:index" element={<CoomerImageViewer />} />
          <Route path="*" element={
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/add" element={<AddEditLink />} />
                <Route path="/edit/:id" element={<AddEditLink />} />
                <Route path="/add-gallery" element={<AddGalleryLinks />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/stashdb" element={<StashDb />} />
                <Route path="/manage-actors" element={<ActorManagement />} />
                <Route path="/manage-actors/add" element={<AddEditActor />} />
                <Route path="/manage-actors/edit/:id" element={<AddEditActor />} />
                <Route path="/manage-studios" element={<StudioManagement />} />
                <Route path="/manage-studios/add" element={<AddEditStudio />} />
                <Route path="/manage-studios/edit/:id" element={<AddEditStudio />} />
                <Route path="/manage-hanime" element={<HanimeManagement />} />
                <Route path="/manage-hanime/add" element={<AddEditHanime />} />
                <Route path="/manage-hanime/edit/:id" element={<AddEditHanime />} />
                <Route path="/manage-hanime/second-covers" element={<SecondCovers />} />
                <Route path="/manage-hanime/episodes" element={<AddEpisodes />} />
                <Route path="/edit-episode/:hanimeId/:episodeId" element={<EditEpisode />} />
                <Route path="/hanime/:id" element={<HanimeDetail />} />
                <Route path="/manage-coomers" element={<CoomerManagement />} />
                <Route path="/manage-coomers/add" element={<AddEditCoomer />} />
                <Route path="/manage-coomers/edit/:id" element={<AddEditCoomer />} />
                <Route path="/coomer/:id" element={<CoomerDetail />} />
                <Route path="/coomer/:id/add-socials" element={<AddCoomerSocials />} />
                <Route path="/coomer/:id/add-socials/:postId" element={<AddCoomerSocials />} />
                <Route path="/actor/:id" element={<ActorLinks />} />
                <Route path="/studio/:id" element={<StudioLinks />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          } />
        </Routes>
      </Router>
    </AppProvider>
  );
};

export default App;

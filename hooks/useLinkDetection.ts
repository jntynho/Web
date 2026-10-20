import React, { useCallback } from 'react';
import { Studio, Actor, AspectRatio } from '../types';

export const useLinkDetection = (
  actors: Actor[],
  studios: Studio[],
  setSelectedActorIds: React.Dispatch<React.SetStateAction<string[]>>,
  setSelectedStudioIds: React.Dispatch<React.SetStateAction<string[]>>,
  setAspectRatio: React.Dispatch<React.SetStateAction<AspectRatio>>
) => {
  const cleanString = (str: string) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/\.(com|net|org|edu|gov|io|tv|me|info|biz)\b/gi, '') 
      .replace(/[^a-z0-9]/g, ''); 
  };

  const performIntelligentDetection = useCallback((inputText: string, currentStudioIds: string[]) => {
    const target = cleanString(inputText);
    if (!target || target.length < 3) return;

    const codeRegex = /[A-Z0-9]{2,10}-\d{2,10}/i;
    if (codeRegex.test(inputText)) {
      setAspectRatio('3:2');
      const missavStudio = studios.find(t => t.name.toUpperCase() === 'MISSAV');
      if (missavStudio && currentStudioIds.length === 0) {
        setSelectedStudioIds([missavStudio.id]);
      }
    }

    const newActorIds: string[] = [];
    (actors || []).forEach(actor => {
      
      const cleanActor = cleanString(actor.name);
      if (cleanActor.length > 2 && target.includes(cleanActor)) {
        newActorIds.push(actor.id);
      }
    });

    const matchingStudios: Studio[] = [];
    (studios || []).forEach(studio => {
      
      const cleanStudio = cleanString(studio.name);
      if (cleanStudio.length > 1 && target.includes(cleanStudio)) {
        matchingStudios.push(studio);
      }
    });

    // Mobile-friendly Network Sub-studio Aliases (e.g. Hussie Pass, BangBros network)
    const NETWORK_SUBSTUDIO_ALIASES: Record<string, string[]> = {
      'pornhub': ['prnhub', 'pornhub'],
      'prnhub': ['prnhub', 'pornhub'],
      'dadsloveporn': ['dadsloveporn', 'dads love porn', 'bangbros', 'bang bros'],
      'dadslove': ['dadsloveporn', 'dads love porn', 'bangbros', 'bang bros'],
      'hotandtatted': ['hot and tatted', 'hussie pass'],
      'hussieauditions': ['hussie auditions', 'hussie pass'],
      'interracialpovs': ['interracial povs', 'interracial pov', 'hussie pass'],
      'interracialpov': ['interracial povs', 'interracial pov', 'hussie pass'],
      'povpornstars': ['pov pornstars', 'pov porn stars', 'hussie pass'],
      'hussiepass': ['hussie pass']
    };

    for (const [key, aliases] of Object.entries(NETWORK_SUBSTUDIO_ALIASES)) {
      if (target.includes(key)) {
        for (const alias of aliases) {
          const matched = studios.find(s => cleanString(s.name) === cleanString(alias));
          if (matched && !matchingStudios.some(m => m.id === matched.id)) {
            matchingStudios.push(matched);
          }
        }
      }
    }

    const finalStudioIds: string[] = [];
    matchingStudios.forEach(studio => {
      const isShadowed = matchingStudios.some(other => 
        other.id !== studio.id && 
        other.name.toLowerCase().includes(studio.name.toLowerCase()) &&
        other.name.length > studio.name.length
      );
      if (!isShadowed) {
        finalStudioIds.push(studio.id);
      }
    });

    if (newActorIds.length > 0) {
      setSelectedActorIds(prev => Array.from(new Set([...prev, ...newActorIds])));
    }
    
    if (finalStudioIds.length > 0 && currentStudioIds.length === 0) {
      setSelectedStudioIds([finalStudioIds[0]]);
    }
  }, [actors, studios, setSelectedActorIds, setSelectedStudioIds, setAspectRatio]);

  return { performIntelligentDetection };
};

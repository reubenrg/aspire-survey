/**
 * Respondent file and signature uploads, stored in the private `survey-uploads`
 * storage bucket. Respondents can only ADD files (the bucket policy allows anon
 * inserts while the survey is open); nobody but analysts of the survey's own
 * customer can read them back, through short-lived signed links.
 */
import { createContext, useContext } from 'react';
import { supabase } from '../lib/supabase';

export const UPLOAD_BUCKET = 'survey-uploads';
export * from './uploadRules';
import { uploadPath } from './uploadRules';

/** Provided by the respondent pages. Absent in the Builder preview, where uploads are simulated. */
export const UploadContext = createContext<{ slug: string } | null>(null);
export const useUploadScope = () => useContext(UploadContext);

export async function uploadAnswerFile(slug: string, file: Blob, fileName: string): Promise<string> {
  const path = uploadPath(slug, fileName);
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    throw new Error('The file could not be uploaded. The survey may have closed, or the file may not be allowed.');
  }
  return path;
}

/** A short-lived link for an analyst to open an uploaded file. */
export async function signedUploadUrl(path: string, seconds = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}


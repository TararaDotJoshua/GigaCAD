import { Suspense } from 'react';
import { AuthForm } from '../../../components/AuthForm';

export const metadata = { title: 'Choose a new password' };

export default function Page() { return <Suspense><AuthForm mode="reset" /></Suspense>; }

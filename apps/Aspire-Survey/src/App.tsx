import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import SurveyToaster from './components/SurveyToaster';
import { submitSurvey } from 'zitejs/api';
import { LanguageProvider } from './i18n/LanguageContext';
import SurveyHeader from './components/SurveyHeader';
import WelcomePage from './components/Steps/WelcomePage';
import AboutYouStep, { type AboutYouData } from './components/Steps/AboutYouStep';
import ChangeStep from './components/Steps/ChangeStep';
import ProblemsStep from './components/Steps/ProblemsStep';
import ManagerStep from './components/Steps/ManagerStep';
import AspireBehaviourStep from './components/Steps/AspireBehaviourStep';
import HabitStep from './components/Steps/HabitStep';
import HelpedImproveStep from './components/Steps/HelpedImproveStep';
import ImpactSeenStep from './components/Steps/ImpactSeenStep';
import EvidenceStep from './components/Steps/EvidenceStep';
import BarriersStep from './components/Steps/BarriersStep';
import PMSStep from './components/Steps/PMSStep';
import RoleStep from './components/Steps/RoleStep';
import FinalQuestionStep from './components/Steps/FinalQuestionStep';
import ThankYouPage from './components/Steps/ThankYouPage';
import { HABIT_LEVELS } from './data/SurveyData';

// 0=welcome, 1–13=sections, 14=thankYou
const TOTAL = 13;
const STEP_LABELS = [
  '',
  ...Array.from({ length: TOTAL }, (_, i) => `Section ${i + 1} of ${TOTAL}`),
  '',
];

export default function App() {
  const [step, setStep] = useState(0);
  const [aboutYou, setAboutYou] = useState<AboutYouData>({ employeeId: '', employeeName: '', role: '', location: '' });

  // Section 2
  const [changeMatrix, setChangeMatrix] = useState<Record<string, string>>({});

  // Section 3
  const [mistakeResponse, setMistakeResponse] = useState('');
  const [workLevel, setWorkLevel] = useState('');

  // Section 4
  const [managerMatrix, setManagerMatrix] = useState<Record<string, string>>({});
  const [managerFrequency, setManagerFrequency] = useState('');

  // Section 5
  const [behaviourMatrix, setBehaviourMatrix] = useState<Record<string, string>>({});

  // Section 6
  const [habitLevel, setHabitLevel] = useState('');

  // Section 7
  const [factors, setFactors] = useState<string[]>([]);
  const [factorsOther, setFactorsOther] = useState('');

  // Section 8
  const [impacts, setImpacts] = useState<string[]>([]);
  const [impactsOther, setImpactsOther] = useState('');

  // Section 9
  const [evidence, setEvidence] = useState({ oneThing: '', example: '', contributedMost: '', aspireContribution: '', aspireDetail: '' });
  const [evidenceOther, setEvidenceOther] = useState('');

  // Section 10
  const [barrier, setBarrier] = useState('');
  const [barrierOther, setBarrierOther] = useState('');
  const [helpOption, setHelpOption] = useState('');
  const [helpOther, setHelpOther] = useState('');

  // Section 11
  const [pmsClarity, setPmsClarity] = useState('');

  // Section 12
  const [roleAnswers, setRoleAnswers] = useState<Record<string, string>>({});

  // Section 13
  const [finalAnswer, setFinalAnswer] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const next = useCallback(() => { setStep((s) => s + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);
  const back = useCallback(() => { setStep((s) => Math.max(0, s - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  const habitLevelDbValue = (() => {
    const idx = HABIT_LEVELS.indexOf(habitLevel);
    const map: Record<number, string> = {
      0: 'Only when reminded', 1: 'Remember but inconsistent', 2: 'Consciously practice sometimes',
      3: 'Regularly apply', 4: 'Naturally part of work', 5: 'Help others practice',
    };
    return map[idx];
  })();

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const allResponses = {
        change: changeMatrix,
        mistakeResponse, workLevel,
        manager: managerMatrix, managerFrequency,
        aspireBehaviour: behaviourMatrix,
        habitLevel,
        factors, factorsOther, impacts, impactsOther,
        evidence, evidenceOther,
        barrier, barrierOther, helpOption, helpOther,
        pmsClarity,
        roleSpecific: { role: aboutYou.role, answers: roleAnswers },
        finalAnswer,
      };
      await submitSurvey({
        employeeId: aboutYou.employeeId.trim(),
        employeeName: aboutYou.employeeName.trim(),
        aspireTeamRole: aboutYou.role,
        location: aboutYou.location,
        responsesJson: JSON.stringify(allResponses),
        aspireUsefulnessScore: 0,
        habitLevel: habitLevelDbValue,
      });
      next();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Submission failed. Please try again.';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const sectionNum = Math.min(step, TOTAL);

  return (
    <LanguageProvider>
      <SurveyToaster />
      {step > 0 && step <= TOTAL && (
        <SurveyHeader currentSection={sectionNum} totalSections={TOTAL} sectionLabel={STEP_LABELS[step] || ''} />
      )}
      <div className="min-h-screen">
        {step === 0 && <WelcomePage onStart={next} />}
        {step === 1 && <AboutYouStep data={aboutYou} onChange={setAboutYou} onNext={next} />}
        {step === 2 && (
          <ChangeStep
            matrixAnswers={changeMatrix}
            onMatrixChange={(r, v) => setChangeMatrix((p) => ({ ...p, [r]: v }))}
            onNext={next} onBack={back}
          />
        )}
        {step === 3 && (
          <ProblemsStep
            mistakeResponse={mistakeResponse} workLevel={workLevel}
            onMistakeChange={setMistakeResponse} onWorkLevelChange={setWorkLevel}
            onNext={next} onBack={back}
          />
        )}
        {step === 4 && (
          <ManagerStep
            matrixAnswers={managerMatrix} frequency={managerFrequency}
            onMatrixChange={(r, v) => setManagerMatrix((p) => ({ ...p, [r]: v }))}
            onFrequencyChange={setManagerFrequency}
            onNext={next} onBack={back}
          />
        )}
        {step === 5 && (
          <AspireBehaviourStep
            matrixAnswers={behaviourMatrix}
            onMatrixChange={(r, v) => setBehaviourMatrix((p) => ({ ...p, [r]: v }))}
            onNext={next} onBack={back}
          />
        )}
        {step === 6 && (
          <HabitStep habitLevel={habitLevel} onHabitChange={setHabitLevel} onNext={next} onBack={back} />
        )}
        {step === 7 && (
          <HelpedImproveStep factors={factors} onFactorsChange={setFactors} otherText={factorsOther} onOtherTextChange={setFactorsOther} onNext={next} onBack={back} />
        )}
        {step === 8 && (
          <ImpactSeenStep impacts={impacts} onImpactsChange={setImpacts} otherText={impactsOther} onOtherTextChange={setImpactsOther} onNext={next} onBack={back} />
        )}
        {step === 9 && (
          <EvidenceStep
            oneThing={evidence.oneThing} example={evidence.example}
            contributedMost={evidence.contributedMost} aspireContribution={evidence.aspireContribution}
            aspireDetail={evidence.aspireDetail}
            contributedMostOther={evidenceOther} onContributedMostOtherChange={setEvidenceOther}
            onChange={(k, v) => setEvidence((p) => ({ ...p, [k]: v }))}
            onNext={next} onBack={back}
          />
        )}
        {step === 10 && (
          <BarriersStep
            barrier={barrier} helpOption={helpOption}
            barrierOther={barrierOther} helpOther={helpOther}
            onBarrierChange={setBarrier} onHelpChange={setHelpOption}
            onBarrierOtherChange={setBarrierOther} onHelpOtherChange={setHelpOther}
            onNext={next} onBack={back}
          />
        )}
        {step === 11 && (
          <PMSStep value={pmsClarity} onChange={setPmsClarity} onNext={next} onBack={back} />
        )}
        {step === 12 && (
          <RoleStep
            role={aboutYou.role} answers={roleAnswers}
            onChange={(r, v) => setRoleAnswers((p) => ({ ...p, [r]: v }))}
            onNext={next} onBack={back}
          />
        )}
        {step === 13 && (
          <FinalQuestionStep
            value={finalAnswer} onChange={setFinalAnswer}
            onSubmit={handleSubmit} onBack={back} isSubmitting={isSubmitting}
          />
        )}
        {step === 14 && <ThankYouPage />}
      </div>
    </LanguageProvider>
  );
}

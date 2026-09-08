import {
	ASPIRE_BEHAVIOUR_ROWS as BEHAVIOUR_ROWS,
	CHANGE_ROWS,
	MANAGER_ROWS,
} from './data/SurveyData';

interface SurveySubmission {
	employeeId: string;
	employeeName: string;
	aspireTeamRole: string;
	location: string;
	responsesJson: string;
	aspireUsefulnessScore: number;
	habitLevel?: string;
}

function matrixColumns(prefix: string, rows: readonly string[], matrix: Record<string, string> | undefined) {
	return Object.fromEntries(rows.map((row, index) => [`${prefix}_${String(index + 1).padStart(2, '0')}`, matrix?.[row] || null]));
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '');
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function submitSurvey(input: SurveySubmission) {
	if (!supabaseUrl || !supabaseAnonKey) {
		throw new Error('Survey database is not configured. Add the Supabase environment variables and try again.');
	}
	const answers = JSON.parse(input.responsesJson) as Record<string, any>;
	const roleAnswers = answers.roleSpecific?.answers || {};
	const roleValues = Object.values(roleAnswers) as string[];

	const response = await fetch(`${supabaseUrl}/rest/v1/survey_responses`, {
		method: 'POST',
		headers: {
			apikey: supabaseAnonKey,
			Authorization: `Bearer ${supabaseAnonKey}`,
			'Content-Type': 'application/json',
			// The public form intentionally has INSERT-only access. Asking PostgREST
			// to return the new row would also require granting anonymous SELECT.
			Prefer: 'return=minimal',
		},
		body: JSON.stringify({
			employee_id: input.employeeId,
			employee_name: input.employeeName,
			aspire_team_role: input.aspireTeamRole,
			location: input.location,
			responses_json: answers,
			aspire_usefulness_score: input.aspireUsefulnessScore,
			habit_level: input.habitLevel || null,
			...matrixColumns('s2_change', CHANGE_ROWS, answers.change),
			s3_mistake_response: answers.mistakeResponse || null,
			s3_work_level: answers.workLevel || null,
			...matrixColumns('s4_manager', MANAGER_ROWS, answers.manager),
			s4_manager_frequency: answers.managerFrequency || null,
			...matrixColumns('s5_behaviour', BEHAVIOUR_ROWS, answers.aspireBehaviour),
			s7_improvement_factors: answers.factors || [],
			s7_factors_other: answers.factorsOther || null,
			s8_impact_areas: answers.impacts || [],
			s8_impacts_other: answers.impactsOther || null,
			s9_one_thing_differently: answers.evidence?.oneThing || null,
			s9_real_example: answers.evidence?.example || null,
			s9_contributed_most: answers.evidence?.contributedMost || null,
			s9_contributed_most_other: answers.evidenceOther || null,
			s9_aspire_contribution: answers.evidence?.aspireContribution || null,
			s9_aspire_detail: answers.evidence?.aspireDetail || null,
			s10_barrier: answers.barrier || null,
			s10_barrier_other: answers.barrierOther || null,
			s10_help_option: answers.helpOption || null,
			s10_help_other: answers.helpOther || null,
			s11_pms_clarity: answers.pmsClarity || null,
			s12_role: answers.roleSpecific?.role || null,
			s12_role_q1: roleValues[0] || null,
			s12_role_q2: roleValues[1] || null,
			s12_role_q3: roleValues[2] || null,
			s13_final_answer: answers.finalAnswer || null,
		}),
	});

	if (!response.ok) {
		if (response.status === 409) {
			throw new Error('A response has already been submitted for this Employee ID. Each employee may submit only once.');
		}
		let message = 'Submission failed. Please try again.';
		try {
			const details = await response.json() as { message?: string; hint?: string };
			message = details.message || details.hint || message;
		} catch {
			// Keep the user-facing fallback when Supabase does not return JSON.
		}
		throw new Error(message);
	}

	return { success: true, id: input.employeeId };
}

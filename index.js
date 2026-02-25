// 필요한 SillyTavern 및 확장 API 함수 import
import { getContext, saveMetadataDebounced, renderExtensionTemplateAsync } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';

// 확장 이름 정의 (로그 및 식별용)
const EXTENSION_NAME = 'PresetTrackerEnhanced';

// 채팅 메타데이터에 프리셋 정보를 저장할 때 사용할 키
// 형식: { "정규화된send_date_model_정규화된model": Object }
const METADATA_KEY = 'presetsBySwipeKey';

// 불필요 데이터 정리 작업 진행 상태를 추적하는 플래그
let isCleaningInProgress = false;
// 가장 최근에 수집된 프리셋 정보를 임시 저장하는 변수 (키와 값 객체)
let latestPresetInfo = { key: null, value: null }; // value는 항상 객체 또는 null

// --- Helper 함수: 현재 UI에서 선택된 컨텍스트 템플릿 이름 가져오기 ---
function _getSelectedContextTemplateName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - ContextTemplate Helper]`;
    let selectedName = null; // 기본값을 null로 변경 (명시적 실패 표현)
    try {
        const $selectElement = $('#context_presets');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                // 기본적인 유효성 검사 (빈 값 또는 플레이스홀더 제외)
                if (!selectedName || selectedName.startsWith('---') || selectedName.startsWith('(')) {
                    selectedName = null; // 유효하지 않으면 null 처리
                }
            }
        } else {
            console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #context_presets.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting context template name:`, error);
        selectedName = null; // 오류 시 null
    }
    // 최종 반환 전 null이면 실패 로그 (선택적)
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid context template name.`);
    return selectedName;
}

// --- Helper 함수: 현재 UI에서 선택된 지시 템플릿 이름 가져오기 ---
function _getSelectedInstructTemplateName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - InstructTemplate Helper]`;
    let selectedName = null;
    try {
        const $selectElement = $('#instruct_presets');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                if (!selectedName || selectedName.startsWith('---') || selectedName.startsWith('(')) {
                    selectedName = null;
                }
            }
        } else {
            console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #instruct_presets.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting instruct template name:`, error);
        selectedName = null;
    }
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid instruct template name.`);
    return selectedName;
}

// --- Helper 함수: 현재 UI에서 선택된 시스템 프롬프트 이름 가져오기 ---
function _getSelectedSystemPromptName() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - SystemPrompt Helper]`;
    let selectedName = null;
    try {
        const $selectElement = $('#sysprompt_select');
        if ($selectElement.length === 1) {
            const $selectedOption = $selectElement.find('option:selected');
            if ($selectedOption.length === 1) {
                selectedName = $selectedOption.text();
                // 시스템 프롬프트는 "None"이 유효한 값일 수 있으므로, 조금 다른 유효성 검사
                if (selectedName === null || selectedName === undefined || selectedName.startsWith('(')) {
                   selectedName = null; // 명백히 유효하지 않은 경우만 null
                }
                // "None"은 유효하므로 그대로 둠.
            }
        } else {
             console.error(`${DEBUG_PREFIX} Error: Found ${$selectElement.length} elements with ID #sysprompt_select.`);
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting system prompt name:`, error);
        selectedName = null;
    }
    // if (selectedName === null) console.log(`${DEBUG_PREFIX} Could not get a valid system prompt name.`);
    return selectedName;
}


// --- Helper 함수: 현재 UI에서 선택된 프리셋 이름 가져오기 ---
function _getCurrentPresetNameFromUI() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - Preset Helper]`;
    let currentPresetName = null;
    try {
        // API별 프리셋 select ID 목록
        const presetSelectIds = [
            '#settings_preset_openai',           // Chat Completion (OpenAI, Google 등)
            '#settings_preset',                   // KoboldAI
            '#settings_preset_novel',             // NovelAI  
            '#settings_preset_textgenerationwebui' // Text Completion
        ];
        
        for (const selectId of presetSelectIds) {
            const $select = $(selectId);
            // 존재하고, 부모 div가 숨겨지지 않았는지 확인
            if ($select.length === 1 && $select.closest('div[style*="display: none"]').length === 0) {
                const selectedOption = $select.find('option:selected');
                if (selectedOption.length === 1) {
                    currentPresetName = selectedOption.text();
                    if (currentPresetName && !currentPresetName.startsWith('---') && !currentPresetName.startsWith('(')) {
                        break; // 유효한 값 찾으면 종료
                    }
                    currentPresetName = null;
                }
            }
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error extracting preset name:`, error);
        currentPresetName = null;
    }
    return currentPresetName;
}

// --- Helper 함수: 현재 선택된 API가 Text Completion인지 확인 ---
function _isTextCompletionSelected() {
    const DEBUG_PREFIX = `[${EXTENSION_NAME} - ApiCheck Helper]`;
    try {
        const $apiSelect = $('#main_api');
        if ($apiSelect.length === 1) {
            const selectedApiValue = $apiSelect.val();
            // 'textgenerationwebui' 값이 Text Completion API를 나타냅니다.
            return selectedApiValue === 'textgenerationwebui';
        } else {
            console.warn(`${DEBUG_PREFIX} Could not find API select element #main_api.`);
            return false;
        }
    } catch (error) {
        console.error(`${DEBUG_PREFIX} Error checking selected API:`, error);
        return false;
    }
}


// 디버그용 Helper 함수: 현재 UI에서 선택된 프롬프트 관련 데이터 취합 및 포맷
function _view_promptDataFromUI() {
    const DEBUG_PREFIX_VIEW = `[${EXTENSION_NAME} - ViewPromptData]`;
    try {
        const isTextComp = _isTextCompletionSelected();
        const generationPreset = _getCurrentPresetNameFromUI() || '(정보 없음)'; // null이면 대체 텍스트

        let outputString = `  - API Type: ${isTextComp ? 'Text Completion' : 'Other'}\n`;
        outputString += `  - Generation Preset: ${generationPreset}\n`;

        if (isTextComp) {
            const contextTemplate = _getSelectedContextTemplateName() || '(정보 없음)';
            const instructTemplate = _getSelectedInstructTemplateName() || '(정보 없음)';
            const systemPrompt = _getSelectedSystemPromptName(); // "None" 가능
            outputString += `  - Context Template: ${contextTemplate}\n`;
            outputString += `  - Instruct Template: ${instructTemplate}\n`;
            outputString += `  - System Prompt: ${systemPrompt !== null ? systemPrompt : '(정보 없음)'}`; // null일 때만 대체
        }

        return outputString;

    } catch (error) {
        console.error(`${DEBUG_PREFIX_VIEW} Error gathering prompt data from UI:`, error);
        return "  Error retrieving prompt data. Check console for details.";
    }
}

// --- Helper 함수: 메시지/스와이프의 send_date와 model 이름을 조합하여 정규화된 키 생성 ---
function _createSwipeKey(sendDate, modelName) {
    if (!sendDate) {
        return null;
    }
    const normalizedSendDate = String(sendDate).replace(/\s+/g, '').toLowerCase();
    const normalizedModelName = (modelName || 'unknown').toLowerCase();
    const key = `${normalizedSendDate}_model_${normalizedModelName}`;
    return key;
}

// --- Helper 함수: 데이터 소스와 UI 상태 기반으로 저장할 프리셋 정보 객체 수집 및 형식화 ---
// --- Helper 함수: 데이터 소스와 UI 상태 기반으로 저장할 프리셋 정보 객체 수집 및 형식화 ---
// <<< 파라미터 추가: forcedModelName >>>
function _collectAndFormatPresetData(dataSource, forcedModelName = null) {
    const DEBUG_PREFIX_COLLECT = `[${EXTENSION_NAME} - CollectData]`;
    if (!dataSource) {
        console.warn(`${DEBUG_PREFIX_COLLECT} dataSource is missing.`);
        // dataSource가 없어도 UI 상태는 수집 가능하므로 null 반환 대신 빈 객체로 시작
        // return null;
    }

    const valueObject = {};
    const isTextComp = _isTextCompletionSelected();

    // 1. Generation Preset (항상 시도)
    const genPresetName = _getCurrentPresetNameFromUI();
    if (genPresetName) {
        valueObject.genPreset = genPresetName;
    }

    // 2. Text Completion 상세 정보 (Text Completion API 일 때만 시도)
    if (isTextComp) {
        const ctxTplName = _getSelectedContextTemplateName();
        if (ctxTplName) {
            valueObject.ctxTpl = ctxTplName;
        }
        const insTplName = _getSelectedInstructTemplateName();
        if (insTplName) {
            valueObject.insTpl = insTplName;
        }
        const sysPptName = _getSelectedSystemPromptName();
        if (sysPptName !== null) {
             valueObject.sysPpt = sysPptName;
        }
    }

    // <<< 3. 강제 지정된 모델 이름 추가 (제공된 경우) >>>
    if (forcedModelName && typeof forcedModelName === 'string' && forcedModelName.trim() !== '') {
        valueObject.forcedModel = forcedModelName.trim(); // 'forcedModel' 키로 저장
        console.log(`${DEBUG_PREFIX_COLLECT} Added forced model name to value object: "${valueObject.forcedModel}"`);
    }

    // 4. 최종 객체 유효성 확인 (하나 이상의 유효한 속성이 있는지)
    if (Object.keys(valueObject).length > 0) {
        console.log(`${DEBUG_PREFIX_COLLECT} Collected data object:`, valueObject);
        return valueObject;
    } else {
        console.warn(`${DEBUG_PREFIX_COLLECT} No valid preset/template/model information could be collected from UI.`);
        return null; // 유효한 정보가 하나도 없으면 null 반환
    }
}


// --- Helper 함수 끝 ---

// 상태 리셋 함수: 채팅 변경 시 호출되어 설정 재로드
function resetState() {
    loadSettings();
}

// 메타데이터 저장 함수: 수집된 최신 프리셋 정보를 메타데이터에 조건부 저장
function saveState() {
    const DEBUG_PREFIX_SAVE = `[${EXTENSION_NAME} - SaveState]`;
    const context = globalThis.SillyTavern.getContext();
    if (!context || !context.chatMetadata) {
        console.error(`${DEBUG_PREFIX_SAVE} Critical Error: Context or chatMetadata is not available! Aborting saveState.`);
        return;
    }
    const chatMetadata = context.chatMetadata;
    let targetMetadata = chatMetadata[METADATA_KEY];

    if (typeof targetMetadata !== 'object' || targetMetadata === null) {
        targetMetadata = {};
        chatMetadata[METADATA_KEY] = targetMetadata;
    }

    const newKey = latestPresetInfo.key;
    const newValueObject = latestPresetInfo.value; // 이제 항상 객체 또는 null

    // 키와 값 객체가 모두 유효할 때만 저장 시도
    if (newKey && typeof newKey === 'string' && newKey.trim() !== '' && newValueObject && typeof newValueObject === 'object') {
        if (!targetMetadata.hasOwnProperty(newKey)) {
            targetMetadata[newKey] = newValueObject; // 새 객체 저장
            // console.log(`${DEBUG_PREFIX_SAVE} Added new preset info object for key "${newKey}":`, newValueObject);
        } else {
            // console.log(`${DEBUG_PREFIX_SAVE} Key "${newKey}" already exists. Skipping addition.`);
        }
    } else {
        // console.log(`${DEBUG_PREFIX_SAVE} Invalid key ("${newKey}") or value object (${JSON.stringify(newValueObject)}). Skipping save.`);
    }

    saveMetadataDebounced(); // 변경 여부와 관계없이 호출 (Debounce가 처리)
}

// 설정 로드 함수: 확장 로드 시 또는 채팅 변경 시 호출
function loadSettings() {
    const DEBUG_PREFIX_LOAD = `[${EXTENSION_NAME} - LoadSettings]`;
    const context = getContext(); // Use local getContext if available

    if (!context) {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: Context is not available! Aborting loadSettings.`);
        return;
    }

    // Ensure global chatMetadata exists
    const globalContext = globalThis.SillyTavern.getContext();
    if (!globalContext.chatMetadata) {
         console.warn(`${DEBUG_PREFIX_LOAD} globalContext.chatMetadata is initially undefined/null. Initializing as {}.`);
         globalContext.chatMetadata = {};
    }
    const currentChatMetadata = globalContext.chatMetadata;

    latestPresetInfo = { key: null, value: null }; // Reset temporary storage

    if (typeof METADATA_KEY === 'undefined') {
        console.error(`${DEBUG_PREFIX_LOAD} Critical Error: METADATA_KEY is not defined! Aborting metadata load.`);
        return;
    }

    // Ensure metadata storage for this extension exists and is an object
    if (!(METADATA_KEY in currentChatMetadata) || typeof currentChatMetadata[METADATA_KEY] !== 'object' || currentChatMetadata[METADATA_KEY] === null) {
        currentChatMetadata[METADATA_KEY] = {};
        console.log(`${DEBUG_PREFIX_LOAD} Initialized metadata storage at key: ${METADATA_KEY}`);
    }

	console.log(`${DEBUG_PREFIX_LOAD} Settings load complete for ${EXTENSION_NAME}.`);
}


/**
 * Preset Tracker Enhanced: 메타데이터에서 불필요 프리셋 데이터 정리
 * 현재 채팅 기록(메시지 및 스와이프)에 존재하지 않는 프리셋 정보를 삭제합니다.
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _cleanupOrphanPresetData() {
    const DEBUG_PREFIX_CLEANUP = `[${EXTENSION_NAME} - Cleanup]`;

    if (isCleaningInProgress) {
        console.warn(`${DEBUG_PREFIX_CLEANUP} Cleanup already in progress.`);
        toastr.warning('이미 정리 작업이 진행 중입니다.');
        return '정리 작업이 이미 진행 중입니다.';
    }

    try {
        isCleaningInProgress = true;
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chat || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_CLEANUP} Critical error: Context, chat, or chatMetadata not available.`);
            toastr.error('정리 작업 실패: 필수 데이터를 로드할 수 없습니다.');
            return '정리 작업 실패: 필수 데이터 로드 불가.';
        }

        const presetStorage = context.chatMetadata[METADATA_KEY];

        if (!presetStorage || typeof presetStorage !== 'object' || Object.keys(presetStorage).length === 0) {
            toastr.info('정리할 프리셋 데이터가 없습니다.');
            return '정리할 프리셋 데이터가 없습니다.';
        }

        const validKeys = new Set();
        for (const message of context.chat) {
            if (message.is_user || message.is_system) continue;

            let baseKey = _createSwipeKey(message.send_date, message.extra?.model);
            if (baseKey) validKeys.add(baseKey);

            if (Array.isArray(message.swipe_info)) {
                for (const swipe of message.swipe_info) {
                    if (swipe) {
                        let swipeKey = _createSwipeKey(swipe.send_date, swipe.extra?.model);
                        if (swipeKey) validKeys.add(swipeKey);
                    }
                }
            }
        }

        let deletedCount = 0;
        const metadataKeys = Object.keys(presetStorage);
        for (const metadataKey of metadataKeys) {
            if (!validKeys.has(metadataKey)) {
                // console.log(`${DEBUG_PREFIX_CLEANUP} Deleting orphan key: ${metadataKey} (Value type: ${typeof presetStorage[metadataKey]})`);
                delete presetStorage[metadataKey];
                deletedCount++;
            }
        }

        let feedbackMessage;
        if (deletedCount > 0) {
            saveMetadataDebounced();
            feedbackMessage = `${deletedCount}개의 사용하지 않는 프리셋 정보가 정리되었습니다.`;
            toastr.success(feedbackMessage);
        } else {
            feedbackMessage = '사용하지 않는 프리셋 정보가 없어 정리할 내용이 없습니다.';
            toastr.info(feedbackMessage);
        }
        return feedbackMessage;

    } catch (error) {
        console.error(`${DEBUG_PREFIX_CLEANUP} Error during cleanup process:`, error);
        toastr.error('데이터 정리 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
        return '데이터 정리 중 오류 발생.';
    } finally {
        isCleaningInProgress = false;
    }
}

/**
 * Preset Tracker Enhanced: 레거시 문자열 데이터를 새 객체 형식으로 마이그레이션
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _migrateLegacyPresetData() {
    const DEBUG_PREFIX_MIGRATE = `[${EXTENSION_NAME} - Migrate]`;
    try {
        console.log(`${DEBUG_PREFIX_MIGRATE} Starting legacy data migration...`);
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_MIGRATE} Critical error: Context or chatMetadata not available.`);
            toastr.error('마이그레이션 실패: 필수 데이터를 로드할 수 없습니다.');
            return '마이그레이션 실패: 필수 데이터 로드 불가.';
        }

        const presetStorage = context.chatMetadata[METADATA_KEY];

        if (!presetStorage || typeof presetStorage !== 'object' || Object.keys(presetStorage).length === 0) {
            console.log(`${DEBUG_PREFIX_MIGRATE} No preset data found to migrate.`);
            toastr.info('마이그레이션할 레거시 데이터가 없습니다.');
            return '마이그레이션할 레거시 데이터가 없습니다.';
        }

        let convertedCount = 0;
        const keysToMigrate = Object.keys(presetStorage);
        // console.log(`${DEBUG_PREFIX_MIGRATE} Checking ${keysToMigrate.length} entries...`);

        for (const key of keysToMigrate) {
            const value = presetStorage[key];
            // 값이 문자열인 경우만 마이그레이션 대상
            if (typeof value === 'string') {
                // console.log(`${DEBUG_PREFIX_MIGRATE} Migrating key: ${key}, value: "${value}"`);
                presetStorage[key] = { genPreset: value }; // 새 객체 형식으로 변환
                convertedCount++;
            }
        }

        let feedbackMessage;
        if (convertedCount > 0) {
            console.log(`${DEBUG_PREFIX_MIGRATE} Migrated ${convertedCount} legacy entries. Saving metadata...`);
            saveMetadataDebounced(); // 변경 사항 저장
            feedbackMessage = `${convertedCount}개의 레거시 프리셋 데이터가 새로운 형식으로 변환되었습니다.`;
            toastr.success(feedbackMessage);
        } else {
            console.log(`${DEBUG_PREFIX_MIGRATE} No legacy string data found to migrate.`);
            feedbackMessage = '변환할 레거시 데이터가 없습니다.';
            toastr.info(feedbackMessage);
        }
        return feedbackMessage; // 슬래시 커맨드 결과 반환

    } catch (error) {
        console.error(`${DEBUG_PREFIX_MIGRATE} Error during migration process:`, error);
        toastr.error('데이터 마이그레이션 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
        return '데이터 마이그레이션 중 오류 발생.'; // 슬래시 커맨드 결과 반환
    }
}





/**
 * Preset Tracker Enhanced: 특정 메시지/스와이프에 현재 UI 프리셋 정보 강제 저장 (Named Arguments 방식)
 * /pteForceSavePreset messageId=<id> [swipeNumber=<num>] 형식의 명령어를 처리합니다.
 * @param {object} parsedArgs - SlashCommandParser가 파싱한 인수 객체. 예: { messageId: 15, swipeNumber: 2 }
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
 /**
 * Preset Tracker Enhanced: 특정 메시지/스와이프에 현재 UI 프리셋 정보 강제 저장 (Named Arguments 방식)
 * /pteForceSavePreset messageId=<id> [swipeNumber=<num>] 형식의 명령어를 처리합니다.
 * @param {object} parsedArgs - SlashCommandParser가 파싱한 인수 객체. 예: { messageId: "15", swipeNumber: "2" } (값은 문자열일 수 있음!)
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
 /**
 * Preset Tracker Enhanced: 특정 메시지/스와이프에 현재 UI 프리셋 정보 강제 저장 (Named Arguments 방식)
 * /pteForceSavePreset messageId=<id> [swipeNumber=<num>] [model=<name>] 형식의 명령어를 처리합니다.
 * @param {object} parsedArgs - SlashCommandParser가 파싱한 인수 객체. 예: { messageId: "15", swipeNumber: "2", model: "MyModel" }
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
 /**
 * Preset Tracker Enhanced: 특정 메시지/스와이프에 현재 UI 프리셋 정보 강제 저장 (Named Arguments 방식)
 * 키는 원래 메시지/스와이프 정보 사용, 값에만 강제 모델 포함 가능
 * @param {object} parsedArgs - SlashCommandParser가 파싱한 인수 객체.
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
 /**
 * Preset Tracker Enhanced: 특정 메시지/스와이프에 현재 UI 프리셋 정보 강제 저장 (Named Arguments 방식)
 * 키는 원래 메시지/스와이프 정보 사용, 값에는 UI 상태 + 강제 모델(옵션) 저장.
 * model=auto 사용 시 현재 활성화된 모델 자동 감지하여 저장 시도.
 * @param {object} parsedArgs - SlashCommandParser가 파싱한 인수 객체. 예: { messageId: "15", model: "auto" }
 * @returns {Promise<string>} 작업 결과를 나타내는 문자열 메시지
 */
async function _forceSavePresetForMessage(parsedArgs) {
    const DEBUG_PREFIX_FORCE_SAVE = `[${EXTENSION_NAME} - ForceSave]`;
    const USAGE_STRING = "사용법: /pteForceSavePreset messageId=<ID> [swipeNumber=<번호>] [model=<모델이름|auto>]";

    console.log(`${DEBUG_PREFIX_FORCE_SAVE} Received parsed arguments object:`, parsedArgs);

    try {
        // 1. 인수 추출 및 파싱
        const messageIdStr = parsedArgs.messageId;
        const swipeNumberStr = parsedArgs.swipeNumber;
        let modelOverride = parsedArgs.model; // 모델 이름 (문자열, 'auto', 또는 undefined)

        // messageId, swipeNumber 파싱 및 유효성 검사
        const messageId = parseInt(messageIdStr, 10);
        if (isNaN(messageId) || messageId < 0) {
            toastr.error(`유효하지 않은 메시지 ID: "${messageIdStr}". 숫자를 입력하세요.`);
            return `유효하지 않은 메시지 ID: ${messageIdStr}. ${USAGE_STRING}`;
        }
        let targetSwipeIndex = null;
        if (swipeNumberStr !== undefined) {
            const swipeNumberInput = parseInt(swipeNumberStr, 10);
            if (isNaN(swipeNumberInput) || swipeNumberInput <= 0) {
                toastr.error(`유효하지 않은 스와이프 번호: "${swipeNumberStr}". 1 이상의 숫자를 입력하세요.`);
                return `유효하지 않은 스와이프 번호: ${swipeNumberStr}. ${USAGE_STRING}`;
            }
            targetSwipeIndex = swipeNumberInput - 1;
        }

        // 2. 컨텍스트 및 대상 메시지 가져오기
        const context = globalThis.SillyTavern.getContext();
        if (!context || !context.chat || !context.chatMetadata) {
            console.error(`${DEBUG_PREFIX_FORCE_SAVE} Critical error: Context, chat, or chatMetadata not available.`);
            toastr.error("오류: 필수 데이터 로드 실패.");
            return "오류: 필수 데이터 로드 실패.";
        }
        if (messageId >= context.chat.length) {
            toastr.error(`메시지 ID ${messageId}를 찾을 수 없습니다. 채팅 길이는 ${context.chat.length}입니다.`);
            return `메시지 ID ${messageId} 찾을 수 없음`;
        }
        const message = context.chat[messageId];
        if (!message) {
            console.error(`${DEBUG_PREFIX_FORCE_SAVE} Error accessing message data for ID: ${messageId}`);
            toastr.error("오류: 메시지 데이터 접근 실패.");
            return "오류: 메시지 데이터 접근 실패.";
        }
        // 사용자 메시지에는 강제 저장 의미 없음 (프리셋은 AI 응답에 적용되므로)
        //if (message.is_user || message.is_system) {
		//시스템 메세지 임시허용.
		if (message.is_user) {
             toastr.warning(`메시지 ID ${messageId}는 AI 응답 메시지가 아닙니다.`);
             return `ID ${messageId}는 AI 응답 메시지가 아닙니다.`;
        }


        // 3. 대상 스와이프 데이터 소스 결정
        let activeDataSource = null;
        let swipeDescription = "";
        if (targetSwipeIndex !== null) {
            // 특정 스와이프 번호 지정 시
            if (!Array.isArray(message.swipe_info) || targetSwipeIndex >= message.swipe_info.length || !message.swipe_info[targetSwipeIndex]) {
                toastr.error(`메시지 ID ${messageId}에 스와이프 번호 ${targetSwipeIndex + 1}이(가) 없습니다.`);
                return `스와이프 번호 ${targetSwipeIndex + 1} 없음`;
            }
            activeDataSource = message.swipe_info[targetSwipeIndex];
            swipeDescription = `스와이프 #${targetSwipeIndex + 1}`;
        } else {
            // 스와이프 번호 생략 시 현재 활성화된 스와이프 또는 기본 메시지 사용
            const currentSwipeId = message.swipe_id ?? 0; // swipe_id가 null/undefined면 0 사용
             if (Array.isArray(message.swipe_info) && currentSwipeId >= 0 && currentSwipeId < message.swipe_info.length && message.swipe_info[currentSwipeId]) {
                 activeDataSource = message.swipe_info[currentSwipeId];
                 swipeDescription = `현재 스와이프 #${currentSwipeId + 1}`;
             } else if (!Array.isArray(message.swipe_info) || message.swipe_info.length === 0) {
                  // swipe_info가 없거나 비어있으면 기본 메시지 사용
                  activeDataSource = message;
                  swipeDescription = "기본 메시지";
             } else {
                  // 예외: swipe_id가 유효하지 않은 인덱스를 가리키는 경우 (이론상 발생 어려움)
                  console.warn(`${DEBUG_PREFIX_FORCE_SAVE} swipe_id (${currentSwipeId}) is out of bounds for swipe_info length (${message.swipe_info.length}). Falling back to base message for message ID ${messageId}.`);
                  activeDataSource = message;
                  swipeDescription = "기본 메시지 (스와이프 ID 오류)";
             }
        }
        if (!activeDataSource) {
            console.error(`${DEBUG_PREFIX_FORCE_SAVE} Failed to determine active data source for message ID ${messageId} (${swipeDescription}).`);
            toastr.error("오류: 대상 데이터 소스를 결정하지 못했습니다.");
            return "오류: 데이터 소스 결정 실패.";
        }


        // 4. 키(Key) 생성: 항상 원래 메시지/스와이프 데이터 사용
        const sendDate = activeDataSource.send_date;
        const originalModelName = activeDataSource.extra?.model; // 키 생성에는 항상 원래 모델 사용
        const generatedKey = _createSwipeKey(sendDate, originalModelName);

        if (!generatedKey) {
            const errorMsg = `메시지 ID ${messageId} (${swipeDescription})에 대한 고유 키를 생성할 수 없습니다 (send_date: ${sendDate}, original_model: ${originalModelName}).`;
            console.error(`${DEBUG_PREFIX_FORCE_SAVE} ${errorMsg}`);
            toastr.error(errorMsg);
            return "오류: 메타데이터 키 생성 실패.";
        }
        console.log(`${DEBUG_PREFIX_FORCE_SAVE} Generated key based on original data: ${generatedKey} (Original Model: ${originalModelName || 'unknown'})`);


        // 5. *** 값(Value)에 포함될 모델 이름 결정 (model 인자 처리) ***
        let finalModelNameToForce = undefined; // _collectAndFormatPresetData에 전달될 최종 모델 이름

        if (modelOverride && typeof modelOverride === 'string') {
            const modelArgLower = modelOverride.trim().toLowerCase();

            if (modelArgLower === 'auto') {
                // 'auto' 인자 처리
                console.log(`${DEBUG_PREFIX_FORCE_SAVE} 'model=auto' detected. Attempting to get current active model...`);
                const isTextComp = _isTextCompletionSelected();
                let detectedModel = null;

                try {
                    const currentContext = globalThis.SillyTavern.getContext(); // 이미 위에서 null 체크함
                    if (isTextComp) {
                        // 텍스트 컴플리션 API
                        detectedModel = currentContext.onlineStatus; // onlineStatus 객체 안의 model 속성
                        console.log(`${DEBUG_PREFIX_FORCE_SAVE} API is Text Completion. Trying to get model from context.onlineStatus.model`);
                    } else {
                        // 챗 컴플리션 API
                        detectedModel = currentContext.getChatCompletionModel ? currentContext.getChatCompletionModel() : null;
                        console.log(`${DEBUG_PREFIX_FORCE_SAVE} API is Chat Completion. Trying to get model from context.getChatCompletionModel()`);
                    }

                    // 모델 이름 유효성 검사 (null, undefined, 빈 문자열 제외)
                    if (detectedModel && typeof detectedModel === 'string' && detectedModel.trim() !== '') {
                        finalModelNameToForce = detectedModel.trim();
                        console.log(`${DEBUG_PREFIX_FORCE_SAVE} Auto-detected model: "${finalModelNameToForce}"`);
                        toastr.info(`자동 감지된 모델: ${finalModelNameToForce}`);
                    } else {
                        console.warn(`${DEBUG_PREFIX_FORCE_SAVE} Could not auto-detect a valid model name. (isTextComp: ${isTextComp}, detectedValue: ${detectedModel})`);
                        toastr.warning(`현재 활성화된 모델 이름을 자동으로 가져올 수 없습니다. API 연결 상태나 설정을 확인하세요.`);
                        // finalModelNameToForce는 undefined로 유지됨
                    }
                } catch (err) {
                    console.error(`${DEBUG_PREFIX_FORCE_SAVE} Error during auto-detection of model:`, err);
                    toastr.error('모델 자동 감지 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.');
                    // finalModelNameToForce는 undefined로 유지됨
                }
            } else {
                // 'auto'가 아닌 다른 문자열이 입력된 경우
                finalModelNameToForce = modelOverride.trim(); // 입력된 문자열 그대로 사용
                console.log(`${DEBUG_PREFIX_FORCE_SAVE} Using provided model name: "${finalModelNameToForce}"`);
            }
        } else {
            // model 인자가 없거나 유효하지 않은 타입인 경우
            console.log(`${DEBUG_PREFIX_FORCE_SAVE} No valid 'model' argument provided. No model name will be forced in the value object.`);
            // finalModelNameToForce는 undefined로 유지됨
        }


        // 6. 값(Value) 생성: 현재 UI 상태 + 최종 결정된 강제 모델(옵션)
        console.log(`${DEBUG_PREFIX_FORCE_SAVE} Collecting current UI settings to store under key: ${generatedKey}`);
        const valueObject = _collectAndFormatPresetData(activeDataSource, finalModelNameToForce); // 결정된 모델 이름 전달

        if (!valueObject) {
            const errorMsg = `현재 UI에서 유효한 프리셋/템플릿 정보를 수집할 수 없었습니다.`;
            console.warn(`${DEBUG_PREFIX_FORCE_SAVE} ${errorMsg}`);
            toastr.warning(errorMsg + " UI 설정을 확인하거나 다시 시도하세요.");
            return "정보 수집 실패: 현재 UI 설정 확인 필요.";
        }
        console.log(`${DEBUG_PREFIX_FORCE_SAVE} Data object to be saved:`, valueObject);

        // 7. 메타데이터에 저장 (생성된 원래 키 사용)
        if (!context.chatMetadata[METADATA_KEY] || typeof context.chatMetadata[METADATA_KEY] !== 'object') {
            context.chatMetadata[METADATA_KEY] = {};
        }
        const presetStorage = context.chatMetadata[METADATA_KEY];
        presetStorage[generatedKey] = valueObject; // 원래 키에 값 저장
        console.log(`${DEBUG_PREFIX_FORCE_SAVE} Saving/Overwriting data for original key "${generatedKey}"`);
        saveMetadataDebounced();

        // 8. 성공 피드백
        let successMsg = `메시지 #${messageId} (${swipeDescription})에 현재 프리셋 정보를 저장했습니다 (Key: ${generatedKey}).`;
        if (valueObject.forcedModel) {
            successMsg += ` (값에 모델 "${valueObject.forcedModel}" 포함)`;
        } else {
             successMsg += ` (값에 강제 모델 미포함)`;
        }
        toastr.success(successMsg);
        console.log(`${DEBUG_PREFIX_FORCE_SAVE} ${successMsg}`);
        return successMsg;

    } catch (error) {
        const errorMsg = `프리셋 강제 저장 중 예상치 못한 오류 발생: ${error.message || error}`;
        console.error(`${DEBUG_PREFIX_FORCE_SAVE} Unexpected error:`, error);
        toastr.error("프리셋 강제 저장 중 오류가 발생했습니다. 콘솔 로그를 확인하세요.");
        return `오류: 처리 중 예외 발생 (${error.message || '알 수 없는 오류'}).`;
    }
}






















// jQuery Ready 함수: 문서 로딩 완료 후 실행
jQuery(async () => {
    console.log(`[${EXTENSION_NAME}] Extension Loading...`);
    loadSettings();

    // 초기 UI 상태 확인 (디버그용)
    // console.log(`[${EXTENSION_NAME}] Initial Prompt Settings Check:\n${_view_promptDataFromUI()}`);

    // --- 설정 페이지 HTML 로드 및 추가 ---
    try {
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${EXTENSION_NAME}`, 'settings');
        const container = $('#extensions_settings');
        if (container.length > 0) {
            container.append(settingsHtml);
            // console.log(`[${EXTENSION_NAME}] Settings HTML loaded into #extensions_settings.`);
        } else {
            console.warn(`[${EXTENSION_NAME}] Could not find container #extensions_settings.`);
        }
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] Error loading or appending settings HTML:`, error);
    }

    // --- SillyTavern 이벤트 리스너 등록 ---

    eventSource.on(event_types.CHAT_CHANGED, () => {
        console.log(`[${EXTENSION_NAME}] Chat changed, resetting state.`);
        resetState();
    });

    // 새 메시지 수신 시: 프리셋 정보 수집 및 저장 시도 (수정됨)
    eventSource.on(event_types.MESSAGE_RECEIVED, async (msgId) => {
        const DEBUG_PREFIX_MSG = `[${EXTENSION_NAME} - Msg Rcvd]`;
        // console.log(`\n${DEBUG_PREFIX_MSG} === Handler Start === MsgId: ${msgId}`);

        let collectedAndSaved = false; // 플래그 이름 변경
        try {
            const context = getContext();
            if (!context || !context.chat || context.chat.length === 0) {
                // console.warn(`${DEBUG_PREFIX_MSG} Invalid context or empty chat.`);
                return;
            }

            // 마지막 AI 메시지 식별 (기존 로직과 유사)
            let messageIndex = context.chat.length - 1;
            let message = context.chat[messageIndex];
            if (message && message.is_user && messageIndex > 0) {
                 messageIndex--;
                 message = context.chat[messageIndex];
            }

            // 식별된 메시지가 AI 메시지일 경우 처리
            if (message && !message.is_user && !message.is_system) {
                const currentIndex = message.swipe_id ?? 0;
                let currentSwipeData = message;
                if (Array.isArray(message.swipe_info) && currentIndex >= 0 && currentIndex < message.swipe_info.length && message.swipe_info[currentIndex]) {
                    currentSwipeData = message.swipe_info[currentIndex];
                }

                const sendDate = currentSwipeData?.send_date;
                const modelName = currentSwipeData?.extra?.model;
                const generatedKey = _createSwipeKey(sendDate, modelName);

                if (generatedKey) {
                    // 데이터 수집 및 형식화 함수 호출
                    const valueObject = _collectAndFormatPresetData(currentSwipeData);

                    // 유효한 객체가 반환되었을 경우 임시 변수 업데이트
                    if (valueObject) {
                        latestPresetInfo = { key: generatedKey, value: valueObject };
                        collectedAndSaved = true; // 성공 플래그 설정
                        // console.log(`${DEBUG_PREFIX_MSG} Prepared data for key "${generatedKey}":`, valueObject);
                        saveState(); // 즉시 저장 시도 (Debounced)
                    } else {
                         // console.log(`${DEBUG_PREFIX_MSG} No valid data collected for key "${generatedKey}". Skipping save.`);
                    }
                } else {
                    // console.log(`${DEBUG_PREFIX_MSG} Key generation failed. Skipping collection.`);
                }
            } else {
                 // console.log(`${DEBUG_PREFIX_MSG} Last message is not a processable AI message.`);
            }
        } catch (error) {
            console.error(`${DEBUG_PREFIX_MSG} Error during preset info processing:`, error);
        }

        // if (!collectedAndSaved) {
        //     console.log(`${DEBUG_PREFIX_MSG} No preset info was collected or saved.`);
        // }
        // console.log(`${DEBUG_PREFIX_MSG} === Handler End === MsgId: ${msgId}\n`);
    });

    // --- UI 요소 이벤트 리스너 등록 ---

    // 캐릭터 이름 클릭 시: 모델/프리셋 정보 표시 (수정됨 - Text Comp 분기 명확화)
	
	    // --- UI 요소 이벤트 리스너 등록 ---

    // 캐릭터 이름 클릭 시: 모델/프리셋 정보 표시 (수정됨 - forcedModel 표시 추가)
    $(document).off(`click.${EXTENSION_NAME}`, '#chat .mes .name_text');
    $(document).on(`click.${EXTENSION_NAME}`, '#chat .mes .name_text', async function (e) {
        e.preventDefault(); // 기본 동작 방지
        e.stopPropagation(); // 이벤트 버블링 방지

        const nameTextElement = $(this);
        const messageElement = nameTextElement.closest('.mes');
        const messageId = messageElement.attr('mesid');
        const DEBUG_PREFIX_CLICK = `[${EXTENSION_NAME} Click]`;

        if (messageId === undefined) {
            console.warn(`${DEBUG_PREFIX_CLICK} Could not find message ID.`);
            return;
        }

        try {
            const context = globalThis.SillyTavern.getContext();
            if (!context || !context.chat || !context.chatMetadata) {
                console.warn(`${DEBUG_PREFIX_CLICK} Context, chat, or metadata not available.`);
                return;
            }

            const msgIndex = parseInt(messageId);
            if (isNaN(msgIndex) || msgIndex < 0 || msgIndex >= context.chat.length) {
                console.warn(`${DEBUG_PREFIX_CLICK} Invalid message index: ${messageId}`);
                return;
            }

            const message = context.chat[msgIndex];
            if (!message) {
                console.error(`${DEBUG_PREFIX_CLICK} Message object MISSING for ID: ${messageId}.`);
                return;
            }
/*
            if (message.is_user || message.is_system) {
                return; // 사용자/시스템 메시지는 정보 표시 안 함
            }
*/
            if (message.is_user) {
                return; // 사용자 메시지는 정보 표시 안 함
            }

            // 활성화된 스와이프 데이터 가져오기
            const currentSwipeIndex = message.swipe_id ?? 0;
            let activeDataSource = message;
            let toastSwipeText = "";
            if (Array.isArray(message.swipe_info) && currentSwipeIndex >= 0 && currentSwipeIndex < message.swipe_info.length && message.swipe_info[currentSwipeIndex]) {
                activeDataSource = message.swipe_info[currentSwipeIndex];
                toastSwipeText = ` (스와이프 ${currentSwipeIndex + 1})`;
            }

            // 1. *** 모델 이름 결정 (표시용) ***
            const originalModelName = activeDataSource?.extra?.model || '(모델 정보 없음)'; // 원래 모델 이름
            let displayModelName = originalModelName; // 기본값은 원래 모델
            let modelSourceIndicator = ""; // 모델 출처 표시 (예: 강제 지정)

            // 2. 프리셋/템플릿 정보 조회 준비 (키 생성)
            const sendDate = activeDataSource?.send_date;
            const modelForLookup = activeDataSource?.extra?.model; // 키 생성에는 *항상* 원래 모델 사용!
            const lookupKey = _createSwipeKey(sendDate, modelForLookup);
            let storedValue = null;

            // 메타데이터에서 저장된 값 조회
            if (lookupKey && context.chatMetadata[METADATA_KEY]) {
                storedValue = context.chatMetadata[METADATA_KEY][lookupKey];
                 // 로그 추가: 어떤 키로 무엇을 찾았는지 확인
                 console.log(`${DEBUG_PREFIX_CLICK} Looked up key "${lookupKey}". Found value:`, storedValue);
            } else {
                 console.log(`${DEBUG_PREFIX_CLICK} Lookup key "${lookupKey}" not found or metadata missing.`);
            }


            // *** 3. 저장된 값에서 forcedModel 확인 및 표시 모델 업데이트 ***
            if (storedValue && typeof storedValue === 'object' && storedValue.hasOwnProperty('forcedModel') && storedValue.forcedModel) {
                displayModelName = storedValue.forcedModel; // 표시할 모델 이름을 강제 지정된 것으로 변경
                modelSourceIndicator = " (강제 지정됨)"; // 출처 표시 추가
                 console.log(`${DEBUG_PREFIX_CLICK} Found forcedModel in stored data: "${displayModelName}". Updating display.`);
            } else {
                 // forcedModel이 없으면 원래 모델 이름 그대로 사용 (로그 추가)
                 console.log(`${DEBUG_PREFIX_CLICK} No valid forcedModel found in stored data. Using original model for display: "${displayModelName}"`);
            }
            // <<< 모델 이름 결정 끝 >>>


            // 4. Toastr 내용 구성 시작
            let displayTimeoutMs = 5000; // 기본 타임아웃
            let toastTitle = `메시지 #${messageId}${toastSwipeText} 정보`;
            // <<< 표시할 모델 이름 (displayModelName)과 출처 표시 사용 >>>
            let toastContentHtml = `<br><strong>모델:</strong><br>${displayModelName}${modelSourceIndicator}<br><br>`;

            // 5. 저장된 프리셋/템플릿 정보 처리 (기존 로직 유지)
            if (storedValue && typeof storedValue === 'object') {
                const isTextCompletionData = storedValue.hasOwnProperty('ctxTpl') || storedValue.hasOwnProperty('insTpl') || storedValue.hasOwnProperty('sysPpt');

                if (isTextCompletionData) {
                    // ... (Text Completion 데이터 표시 로직 - 이전과 동일) ...
                    displayTimeoutMs = 9000;
                    toastContentHtml += `<strong>프롬프트 (Text Completion) :</strong><br>`;
                    // ... (genPreset, insTpl, sysPpt 등 표시) ...
                    if (storedValue.hasOwnProperty('genPreset')) toastContentHtml += `  - Preset : ${storedValue.genPreset}<br>`; else toastContentHtml += `  - Preset : (정보 없음)<br>`;
                    if (storedValue.hasOwnProperty('insTpl')) toastContentHtml += `  - Instruct Template: ${storedValue.insTpl}<br>`; else toastContentHtml += `  - Instruct Template: (정보 없음)<br>`;
                    if (storedValue.hasOwnProperty('sysPpt')) toastContentHtml += `  - System Prompt: ${storedValue.sysPpt}<br>`; else toastContentHtml += `  - System Prompt: (정보 없음)<br>`;


                } else {
                    // ... (Non-Text Completion 데이터 표시 로직 - 이전과 동일) ...
                     toastContentHtml += `<strong>프롬프트 :</strong><br>`;
                     if (storedValue.hasOwnProperty('genPreset')) toastContentHtml += `  ${storedValue.genPreset}<br>`; else toastContentHtml += `  (프리셋 정보 없음 - 저장 오류)<br>`;
                }
                toastContentHtml += `<br>`;

            } else if (typeof storedValue === 'string') {
                // ... (레거시 데이터 처리 - 이전과 동일) ...
                toastContentHtml += `<strong>레거시 :</strong><br>이전 버전 데이터입니다. 마이그레이션 필요...<br>`;
            } else {
                // ... (저장된 정보 없음 처리 - 이전과 동일) ...
                 toastContentHtml += `<strong>사용 설정:</strong><br>(저장된 프리셋/템플릿 정보 없음)`;
            }

            // 6. Toastr 알림 표시 (이전과 동일)
            const toastOptions = {
                "closeButton": true, "progressBar": true, "positionClass": "toast-top-center",
                "timeOut": String(displayTimeoutMs), "extendedTimeOut": "2000", "escapeHtml": false
            };
            if (typeof toastr === 'object' && typeof toastr.info === 'function') {
                toastr.info(toastContentHtml, toastTitle, toastOptions);
            } else {
                // ... (Toastr 없을 때 콘솔 출력 - 이전과 동일) ...
            }

        } catch (error) {
            // ... (예외 처리 - 이전과 동일) ...
            console.error(`${DEBUG_PREFIX_CLICK} Unexpected error displaying info for message ID ${messageId}:`, error);
            if (typeof toastr === 'object' && typeof toastr.error === 'function') toastr.error('정보 표시 중 오류 발생.');
        }
    }); // end of click handler

});





// --- 슬래시 커맨드 등록 ---
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: 'pteCleanOrphanData',
	callback: _cleanupOrphanPresetData,
	helpString: 'Preset Tracker Enhanced: 사용하지 않는 프리셋 기록(불필요 데이터)을 정리합니다.',
	returns: '정리된 항목 수를 포함한 결과 메시지를 반환합니다.'
}));

// 신규 마이그레이션 커맨드 등록
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
	name: 'pteMigratePresetData',
	callback: _migrateLegacyPresetData,
	helpString: 'Preset Tracker Enhanced: Beta1 버전의 데이터를 이후 버전으로 마이그레이션합니다 (이 작업은 채팅방마다 수행해주어야합니다)',
	returns: '변환된 항목 수를 포함한 결과 메시지를 반환합니다.'
}));


// 		/pteForceSavePreset messageId={{lastMessageId}} model=auto
SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'pteForceSavePreset',
    callback: _forceSavePresetForMessage,
    helpString: 'Preset Tracker Enhanced: 지정된 메시지 ID와 스와이프 번호에 현재 UI의 프리셋/템플릿 설정을 강제로 저장합니다.',
    namedArgumentList: [
        SlashCommandNamedArgument.fromProps({
            name: 'messageId',
            description: '프리셋을 저장할 AI 메시지의 숫자 ID',
            isRequired: true,
            typeList: [ARGUMENT_TYPE.INTEGER],
        }),
        SlashCommandNamedArgument.fromProps({
            name: 'swipeNumber',
            description: '저장할 스와이프 번호 (1부터 시작). 생략 시 현재 활성화된 스와이프 사용.',
            isRequired: false,
            typeList: [ARGUMENT_TYPE.INTEGER],
        }),
        // <<< 새로운 model 인자 정의 추가 >>>
        SlashCommandNamedArgument.fromProps({
            name: 'model', // 인수 이름: model
            description: '키 생성 시 강제로 사용할 모델 이름. 생략 시 메시지/스와이프의 원래 모델 사용.',
            isRequired: false, // 선택적 인자
            typeList: [ARGUMENT_TYPE.STRING], // 타입은 문자열
        }),
    ],
    returns: '작업 성공 또는 실패 메시지를 반환합니다.'
}));


console.log(`[${EXTENSION_NAME}] Event Listeners & Slash Commands Registered.`);
console.log(`[${EXTENSION_NAME}] Extension Loaded Successfully.`);